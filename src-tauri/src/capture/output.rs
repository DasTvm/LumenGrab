//! What happens with a finished capture: save as PNG into Pictures/LumenGrab and copy to the
//! clipboard (both, always, in parallel). Errors become a native dialog; success is silent until the
//! quick-access overlay (M2) gives feedback.

use std::{fs, io::Write, path::Path};

use chrono::{Datelike, Local, Timelike};
use tauri::{image::Image, AppHandle, Manager};
use tauri_plugin_clipboard_manager::ClipboardExt;
use tauri_plugin_dialog::{DialogExt, MessageDialogButtons, MessageDialogKind};

use super::{encode, geometry, Frame};
use crate::platform;

const FOLDER: &str = "LumenGrab";

pub fn deliver(app: &AppHandle, frame: Frame) {
    let dir = match app.path().picture_dir() {
        Ok(p) => p.join(FOLDER),
        Err(e) => {
            error_dialog(app, &format!("The Pictures folder could not be found: {e}"));
            return;
        }
    };
    let (saved, copied) = std::thread::scope(|s| {
        let save = s.spawn(|| save_png(&dir, &frame));
        let copy = s.spawn(|| copy_to_clipboard(app, &frame));
        (
            save.join().unwrap_or_else(|_| Err("saving crashed".into())),
            copy.join()
                .unwrap_or_else(|_| Err("copying crashed".into())),
        )
    });
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

/// Part 1: a plain dialog. Part 2 replaces it with a proper permission window.
pub fn permission_help(app: &AppHandle) {
    app.dialog()
        .message(
            "LumenGrab needs permission to record your screen.\n\n\
             Open System Settings > Privacy & Security > Screen & System Audio Recording, \
             switch LumenGrab on, then quit and reopen LumenGrab.",
        )
        .title("Screen Recording permission needed")
        .buttons(MessageDialogButtons::OkCancelCustom(
            "Open System Settings".into(),
            "Cancel".into(),
        ))
        .show(|open| {
            if open {
                platform::open_screen_recording_settings();
            }
        });
}
