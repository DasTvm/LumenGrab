//! Tauri commands of the Quick Access cards. Typed wrappers: `src/platform/native.ts`.
//! The ones that wait for the OS (clipboard, file dialog) are `async`, so they run on a worker
//! thread and never block the main thread.

use serde::Serialize;
use tauri::AppHandle;
use tauri_plugin_clipboard_manager::ClipboardExt;
use tauri_plugin_dialog::DialogExt;

use super::{card_for_label, close, file_of, resize, CardPayload};
use crate::{capture::encode, platform};

/// The card a (freshly loaded) card window should show, if one is assigned to it.
#[tauri::command]
pub fn quick_access_card(app: AppHandle, label: String) -> Option<CardPayload> {
    card_for_label(&app, &label)
}

/// The page measured itself (and any tooltip room it needs), in CSS pixels.
#[tauri::command]
pub fn quick_access_size(
    app: AppHandle,
    id: String,
    height: f64,
    extra_top: f64,
    extra_bottom: f64,
) {
    resize(&app, &id, height, extra_top, extra_bottom);
}

#[tauri::command]
pub fn quick_access_close(app: AppHandle, id: String) {
    close(&app, &id);
}

/// Copies the saved screenshot to the clipboard again.
#[tauri::command]
pub async fn quick_access_copy(app: AppHandle, id: String) -> Result<(), String> {
    let path = file_of(&app, &id).ok_or("This screenshot is no longer available.")?;
    let bytes = std::fs::read(&path).map_err(|e| format!("{}: {e}", path.display()))?;
    let frame = encode::decode_png(&bytes).map_err(|e| e.to_string())?;
    let image = tauri::image::Image::new(&frame.rgba, frame.width, frame.height);
    app.clipboard()
        .write_image(&image)
        .map_err(|e| e.to_string())
}

/// Shows the file in Finder / Explorer.
#[tauri::command]
pub fn quick_access_reveal(app: AppHandle, id: String) -> Result<(), String> {
    let path = file_of(&app, &id).ok_or("This screenshot is no longer available.")?;
    platform::reveal_file(&path);
    Ok(())
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SavedCopy {
    /// Folder shown to the user, e.g. `Documents/Reports`.
    folder: String,
    file_name: String,
}

/// "Save as…": asks where, then copies the screenshot there. `None` if the user cancelled.
#[tauri::command]
pub async fn quick_access_save_as(app: AppHandle, id: String) -> Result<Option<SavedCopy>, String> {
    let source = file_of(&app, &id).ok_or("This screenshot is no longer available.")?;
    let name = source
        .file_name()
        .map(|n| n.to_string_lossy().into_owned())
        .unwrap_or_else(|| "Screenshot.png".into());
    let mut dialog = app
        .dialog()
        .file()
        .set_file_name(name)
        .add_filter("PNG image", &["png"]);
    if let Some(dir) = source.parent() {
        dialog = dialog.set_directory(dir);
    }
    let Some(chosen) = dialog.blocking_save_file() else {
        return Ok(None);
    };
    let target = chosen.into_path().map_err(|e| e.to_string())?;
    if target != source {
        std::fs::copy(&source, &target).map_err(|e| format!("{}: {e}", target.display()))?;
    }
    Ok(Some(SavedCopy {
        folder: super::short_folder(&target),
        file_name: target
            .file_name()
            .map(|n| n.to_string_lossy().into_owned())
            .unwrap_or_default(),
    }))
}
