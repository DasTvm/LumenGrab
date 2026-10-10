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
use crate::{platform, quick_access, settings::SettingsStore};

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
/// settings say so, and shows the Quick Access card. Problems become notice cards.
pub fn deliver_to(app: &AppHandle, frame: Frame, source: CaptureMode, dir: Option<PathBuf>) {
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
            if !show_quick_access(app, &path, &frame, source) {
                announce_saved(app, &path);
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
fn show_quick_access(app: &AppHandle, path: &Path, frame: &Frame, source: CaptureMode) -> bool {
    let thumb = pixels::downscale(frame, THUMB_WIDTH);
    let Ok(thumb) = encode::encode_png(&thumb, encode::Profile::Fast) else {
        return false;
    };
    quick_access::show(
        app,
        quick_access::NewCard {
            path: path.to_path_buf(),
            width: frame.width,
            height: frame.height,
            source,
            bytes: fs::metadata(path).map(|m| m.len()).unwrap_or(0),
            thumb,
        },
    )
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
