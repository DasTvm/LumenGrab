//! What happens with a finished capture: save as PNG into Pictures/LumenGrab (always) and copy to
//! the clipboard (unless switched off in the settings), in parallel. Errors become a native dialog; success is silent until the
//! quick-access overlay (M2) gives feedback.

use std::{
    fs,
    path::{Path, PathBuf},
    sync::Arc,
};

use chrono::{Datelike, Local, Timelike};
use tauri::{image::Image, AppHandle, Manager};
use tauri_plugin_clipboard_manager::ClipboardExt;
use tauri_plugin_dialog::{DialogExt, MessageDialogKind};

use super::{encode, geometry, pixels, CaptureMode, Frame};
use crate::{history, platform, present, quick_access, settings::SettingsStore};

const FOLDER: &str = "LumenGrab";
/// Twice the 364 px preview of the large card, so it is sharp on a 2x display.
const THUMB_WIDTH: u32 = 728;

/// `Pictures/LumenGrab`.
pub fn screenshot_dir(app: &AppHandle) -> Result<std::path::PathBuf, String> {
    #[cfg(any(debug_assertions, feature = "dev-hooks"))]
    if let Ok(dir) = std::env::var("LUMENGRAB_DEV_SAVE_DIR") {
        return Ok(dir.into());
    }
    app.path()
        .picture_dir()
        .map(|p| p.join(FOLDER))
        .map_err(|e| format!("The Pictures folder could not be found: {e}"))
}

/// Tray entry: opens the folder (created if it does not exist yet).
pub fn open_screenshot_folder(app: &AppHandle) {
    match screenshot_dir(app) {
        Ok(dir) => {
            let _ = fs::create_dir_all(&dir);
            platform::open_folder(&dir);
        }
        Err(e) => error_dialog(app, &e),
    }
}

pub fn deliver(app: &AppHandle, frame: Frame, source: CaptureMode) {
    deliver_to(app, frame, source, None);
}

/// Saves the capture (into `dir`, or the screenshots folder), copies it to the clipboard if the
/// settings say so, and shows the Quick Access card. Problems become notice cards. With the automatic
/// look on, the default look is put on the picture first.
pub fn deliver_to(app: &AppHandle, frame: Frame, source: CaptureMode, dir: Option<PathBuf>) {
    deliver_inner(app, frame, source, dir, true);
}

/// Like `deliver_to` for a picture that already has its look (a retry of a failed save).
pub fn deliver_finished(app: &AppHandle, frame: Frame, source: CaptureMode, dir: Option<PathBuf>) {
    deliver_inner(app, frame, source, dir, false);
}

fn deliver_inner(
    app: &AppHandle,
    frame: Frame,
    source: CaptureMode,
    dir: Option<PathBuf>,
    apply_look: bool,
) {
    // The picture that is saved, copied and shown; `original` is the capture before the look.
    let mut look_failed = false;
    let (frame, original) = if apply_look && app.state::<SettingsStore>().get().presentation.auto {
        match with_look(app, &frame) {
            Ok((presented, original)) => (presented, Some(original)),
            Err(e) => {
                eprintln!("lumengrab: the look could not be applied: {e}");
                look_failed = true;
                (frame, None)
            }
        }
    } else {
        (frame, None)
    };
    let dir = match dir.map_or_else(|| screenshot_dir(app), Ok) {
        Ok(dir) => dir,
        Err(e) => {
            notify_save_failed(app, "Pictures", &e, frame, source);
            return;
        }
    };
    let (saved, copied) = std::thread::scope(|s| {
        let save = s.spawn(|| save_png(&dir, &frame));
        let copy = s.spawn(|| {
            if app.state::<SettingsStore>().get().copy_to_clipboard {
                copy_to_clipboard(app, &frame)
            } else {
                Ok(())
            }
        });
        (
            save.join().unwrap_or_else(|_| Err("saving crashed".into())),
            copy.join()
                .unwrap_or_else(|_| Err("copying crashed".into())),
        )
    });
    #[cfg_attr(not(any(debug_assertions, feature = "dev-hooks")), allow(unused_mut))]
    let mut problems: Vec<String> = Vec::new();
    match saved {
        Ok(path) => {
            // The capture as it was stays for Edit, which puts the look on as a presentation.
            let original_path = original.as_deref().and_then(|bytes| {
                path.file_name()
                    .and_then(|name| present::save_original(app, bytes, name).ok())
            });
            let thumb = make_thumb(&frame);
            // The history keeps its own copy (off the way of the card: it only copies files).
            if let Some(thumb) = &thumb {
                history::record(
                    app,
                    &history::Recorded {
                        saved: Some(&path),
                        png: None,
                        name: None,
                        width: frame.width,
                        height: frame.height,
                        thumb,
                        source,
                        original: original.as_deref(),
                    },
                );
            }
            if !thumb
                .map(|thumb| show_quick_access(app, &path, &frame, source, original_path, thumb))
                .unwrap_or(false)
            {
                announce_saved(app, &path);
            }
            if look_failed {
                quick_access::notify(app, quick_access::notice::look_failed(path.clone()));
            }
            if let Err(e) = copied {
                problems.push(format!("clipboard: {e}"));
                quick_access::notify(app, quick_access::notice::clipboard_failed(&e, path));
            }
        }
        Err(e) => {
            problems.push(format!("save: {e}"));
            notify_save_failed(
                app,
                &quick_access::short_folder(&dir.join("x.png")),
                &e,
                frame,
                source,
            );
        }
    }
    #[cfg(any(debug_assertions, feature = "dev-hooks"))]
    crate::dev::after_deliver(app, &problems);
}

/// The picture with the default look on, and the capture as PNG bytes for the originals folder.
fn with_look(app: &AppHandle, frame: &Frame) -> Result<(Frame, Vec<u8>), String> {
    #[cfg(any(debug_assertions, feature = "dev-hooks"))]
    let started = std::time::Instant::now();
    let original = encode::encode_png(frame, encode::Profile::Fast).map_err(|e| e.to_string())?;
    let presented = present::present(app, frame)?;
    #[cfg(any(debug_assertions, feature = "dev-hooks"))]
    eprintln!(
        "[lumengrab:dev] look applied to {}x{} in {} ms ({}x{} out)",
        frame.width,
        frame.height,
        started.elapsed().as_millis(),
        presented.width,
        presented.height
    );
    Ok((presented, original))
}

/// A text capture: the words are read and copied (or a QR link offered) and a card says so. No file is
/// saved and no Quick Access card shows the picture. Only when the user chose to keep a picture of text
/// captures (Settings > History) does the history get a copy.
pub fn deliver_text(app: &AppHandle, frame: Frame) {
    let Ok(png) = encode::encode_png(&frame, encode::Profile::Fast) else {
        quick_access::notify(
            app,
            quick_access::notice::text_failed("The picture could not be encoded.".into()),
        );
        return;
    };
    let keep = app.state::<SettingsStore>().get().history;
    if keep.enabled && keep.text_picture {
        if let Some(thumb) = make_thumb(&frame) {
            let now = Local::now();
            let name = geometry::file_name(
                now.year(),
                now.month(),
                now.day(),
                now.hour(),
                now.minute(),
                now.second(),
            );
            history::record(
                app,
                &history::Recorded {
                    saved: None,
                    png: Some(&png),
                    name: Some(name),
                    width: frame.width,
                    height: frame.height,
                    thumb: &thumb,
                    source: CaptureMode::Text,
                    original: None,
                },
            );
        }
    }
    crate::ocr::read_and_tell(app, &png);
}

/// "Try again" of the notice: puts the look on a screenshot that was saved as it was. The file is
/// replaced by the finished picture, the capture goes to the originals, the clipboard gets the result.
pub fn apply_look_to_file(app: &AppHandle, path: &Path) -> Result<(), String> {
    let original = fs::read(path).map_err(|e| format!("{}: {e}", path.display()))?;
    let frame = encode::decode_png(&original).map_err(|e| e.to_string())?;
    let finished = present::present(app, &frame)?;
    let png = encode::encode_png(&finished, encode::Profile::Best).map_err(|e| e.to_string())?;
    if let Some(name) = path.file_name() {
        present::save_original(app, &original, name)?;
    }
    crate::fsutil::write_atomic(path, &png).map_err(|e| format!("{}: {e}", path.display()))?;
    if app.state::<SettingsStore>().get().copy_to_clipboard {
        copy_to_clipboard(app, &finished)?;
    }
    Ok(())
}

/// The picture could not be written: it stays in memory so Retry and "Choose folder…" can save it.
fn notify_save_failed(
    app: &AppHandle,
    folder: &str,
    error: &str,
    frame: Frame,
    source: CaptureMode,
) {
    let notice = quick_access::notice::save_failed(folder, error, Arc::new(frame), source);
    if !quick_access::notify(app, notice) {
        error_dialog(app, &format!("The screenshot could not be saved: {error}"));
    }
}

/// The card in the screen corner. `false` if Quick Access is off or could not be shown.
fn show_quick_access(
    app: &AppHandle,
    path: &Path,
    frame: &Frame,
    source: CaptureMode,
    original: Option<PathBuf>,
    thumb: Vec<u8>,
) -> bool {
    quick_access::show(
        app,
        quick_access::NewCard {
            path: path.to_path_buf(),
            width: frame.width,
            height: frame.height,
            source,
            bytes: fs::metadata(path).map(|m| m.len()).unwrap_or(0),
            thumb,
            original,
        },
    )
}

/// The preview of a capture (a PNG), shared by the Quick Access card and the history.
fn make_thumb(frame: &Frame) -> Option<Vec<u8>> {
    let small = pixels::downscale(frame, THUMB_WIDTH);
    encode::encode_png(&small, encode::Profile::Fast).ok()
}

/// Minimal feedback when Quick Access is switched off: the tray tooltip names the file, and on macOS
/// the menu bar icon shows "Saved" next to it for two seconds.
fn announce_saved(app: &AppHandle, path: &Path) {
    let Some(tray) = app.tray_by_id("main") else {
        return;
    };
    let name = path
        .file_name()
        .map(|n| n.to_string_lossy().into_owned())
        .unwrap_or_default();
    let _ = tray.set_tooltip(Some(format!("LumenGrab: saved {name}")));
    let _ = tray.set_title(Some("Saved"));
    std::thread::spawn(move || {
        std::thread::sleep(std::time::Duration::from_secs(2));
        let _ = tray.set_title(None::<&str>);
    });
}

/// Atomic write: temp file in the same folder, then rename.
fn save_png(dir: &Path, frame: &Frame) -> Result<std::path::PathBuf, String> {
    let bytes = encode::encode_png(frame, encode::Profile::Best).map_err(|e| e.to_string())?;
    fs::create_dir_all(dir).map_err(|e| format!("{}: {e}", dir.display()))?;
    let now = Local::now();
    let name = geometry::file_name(
        now.year(),
        now.month(),
        now.day(),
        now.hour(),
        now.minute(),
        now.second(),
    );
    let target = geometry::unique_path(dir, &name, |p| p.exists());
    crate::fsutil::write_atomic(&target, &bytes)
        .map_err(|e| format!("{}: {e}", target.display()))?;
    Ok(target)
}

fn copy_to_clipboard(app: &AppHandle, frame: &Frame) -> Result<(), String> {
    let image = Image::new(&frame.rgba, frame.width, frame.height);
    app.clipboard()
        .write_image(&image)
        .map_err(|e| e.to_string())
}

pub fn error_dialog(app: &AppHandle, message: &str) {
    app.dialog()
        .message(message)
        .title("LumenGrab")
        .kind(MessageDialogKind::Error)
        .show(|_| {});
}
