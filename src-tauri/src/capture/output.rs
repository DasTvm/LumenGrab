//! What happens with a finished capture: save as PNG into Pictures/LumenGrab (always) and copy to
//! the clipboard (unless switched off in the settings), in parallel. Errors become a native dialog; success is silent until the
//! quick-access overlay (M2) gives feedback.

use std::{fs, io::Write, path::Path};

use chrono::{Datelike, Local, Timelike};
use tauri::{image::Image, AppHandle, Manager};
use tauri_plugin_clipboard_manager::ClipboardExt;
use tauri_plugin_dialog::{DialogExt, MessageDialogKind};

use super::{encode, geometry, Frame};
use crate::{platform, settings::SettingsStore};

const FOLDER: &str = "LumenGrab";

/// `Pictures/LumenGrab`.
pub fn screenshot_dir(app: &AppHandle) -> Result<std::path::PathBuf, String> {
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

pub fn deliver(app: &AppHandle, frame: Frame) {
    let dir = match screenshot_dir(app) {
        Ok(dir) => dir,
        Err(e) => {
            error_dialog(app, &e);
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
    if let Ok(path) = &saved {
        announce_saved(app, path);
    }
    let problems: Vec<String> = [
        saved
            .err()
            .map(|e| format!("The screenshot could not be saved: {e}")),
        copied
            .err()
            .map(|e| format!("The screenshot could not be copied to the clipboard: {e}")),
    ]
    .into_iter()
    .flatten()
    .collect();
    if !problems.is_empty() {
        error_dialog(app, &problems.join("\n\n"));
    }
    #[cfg(any(debug_assertions, feature = "dev-hooks"))]
    crate::dev::after_deliver(app, &problems);
}

/// Minimal feedback until the quick-access overlay (M2): the tray tooltip names the file, and on
/// macOS the menu bar icon shows "Saved" next to it for two seconds.
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
    let temp = dir.join(format!(".{name}.tmp"));
    let write = || -> std::io::Result<()> {
        let mut file = fs::File::create(&temp)?;
        file.write_all(&bytes)?;
        file.sync_all()?;
        fs::rename(&temp, &target)
    };
    write().map_err(|e| {
        let _ = fs::remove_file(&temp);
        format!("{}: {e}", target.display())
    })?;
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

/// Shows the permission window (design: Onboarding Permission).
pub fn permission_help(app: &AppHandle) {
    crate::permission::show(app);
}
