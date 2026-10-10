//! Tauri commands of the Quick Access cards. Typed wrappers: `src/platform/native.ts`.
//! The ones that wait for the OS (clipboard, file dialog) are `async`, so they run on a worker
//! thread and never block the main thread.

use std::{path::Path, sync::Arc};

use serde::Serialize;
use tauri::{AppHandle, Emitter};
use tauri_plugin_clipboard_manager::ClipboardExt;
use tauri_plugin_dialog::DialogExt;

use super::{
    card_for_label, close, drag_image, file_of, notice_handler, reserve_hint_room, resize,
    set_pending_delete, CardPayload,
};
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

/// "Delete": the screenshot moves to the Trash when the card closes, unless `quick_access_undo_delete` comes first.
#[tauri::command]
pub fn quick_access_delete(app: AppHandle, id: String) -> Result<(), String> {
    set_pending_delete(&app, &id, true)
        .then_some(())
        .ok_or_else(|| "This screenshot is no longer available.".to_string())
}

#[tauri::command]
pub fn quick_access_undo_delete(app: AppHandle, id: String) -> Result<(), String> {
    set_pending_delete(&app, &id, false)
        .then_some(())
        .ok_or_else(|| "This screenshot is no longer available.".to_string())
}

#[derive(Clone, Serialize)]
struct DragState {
    label: String,
    active: bool,
}

/// Starts a drag of the screenshot file out of the card (into a chat, a folder, a web page...).
/// A sync command on purpose: starting a drag has to happen on the main thread.
///
/// On macOS `start_drag` returns at once and the OS runs the drag; on Windows it **blocks until the
/// drop** (`DoDragDrop`). So "dragging" is announced *before* starting and "done" by the callback
/// (and once more after a blocking call returns), never the other way round: the first version
/// announced it after `start_drag` and left the card "dragging" (timer paused) for good on Windows.
#[tauri::command]
pub fn quick_access_drag(
    app: AppHandle,
    window: tauri::WebviewWindow,
    id: String,
) -> Result<(), String> {
    let path = file_of(&app, &id).ok_or("This screenshot is no longer available.")?;
    let image = drag_image(&app, &id).ok_or("This screenshot is no longer available.")?;
    let label = window.label().to_string();
    let announce = {
        let (app, label) = (app.clone(), label.clone());
        move |active: bool| {
            let _ = app.emit(
                "quick-access-drag",
                DragState {
                    label: label.clone(),
                    active,
                },
            );
        }
    };
    // Room for the hint first: the page cannot ask for it while a blocking drag holds this thread.
    reserve_hint_room(&app, &id);
    announce(true);
    let finished = announce.clone();
    let started = drag::start_drag(
        &window,
        drag::DragItem::Files(vec![path]),
        drag::Image::Raw(image),
        move |_result, _cursor| finished(false),
        drag::Options::default(),
    );
    match started {
        Ok(()) => {
            #[cfg(target_os = "windows")]
            announce(false); // the call blocked until the drop: the drag is over
            Ok(())
        }
        Err(e) => {
            announce(false);
            Err(e.to_string())
        }
    }
}

/// Reads a saved screenshot and puts it on the clipboard.
fn copy_file_to_clipboard(app: &AppHandle, path: &Path) -> Result<(), String> {
    let bytes = std::fs::read(path).map_err(|e| format!("{}: {e}", path.display()))?;
    let frame = encode::decode_png(&bytes).map_err(|e| e.to_string())?;
    let image = tauri::image::Image::new(&frame.rgba, frame.width, frame.height);
    app.clipboard()
        .write_image(&image)
        .map_err(|e| e.to_string())
}

/// Copies the saved screenshot to the clipboard again.
#[tauri::command]
pub async fn quick_access_copy(app: AppHandle, id: String) -> Result<(), String> {
    let path = file_of(&app, &id).ok_or("This screenshot is no longer available.")?;
    copy_file_to_clipboard(&app, &path)
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
/// Blocks on the dialog: call from a worker thread (an `async` command).
fn save_copy(app: &AppHandle, source: &Path) -> Result<Option<SavedCopy>, String> {
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
        std::fs::copy(source, &target).map_err(|e| format!("{}: {e}", target.display()))?;
    }
    Ok(Some(SavedCopy {
        folder: super::short_folder(&target),
        file_name: target
            .file_name()
            .map(|n| n.to_string_lossy().into_owned())
            .unwrap_or_default(),
    }))
}

#[tauri::command]
pub async fn quick_access_save_as(app: AppHandle, id: String) -> Result<Option<SavedCopy>, String> {
    let source = file_of(&app, &id).ok_or("This screenshot is no longer available.")?;
    save_copy(&app, &source)
}

/// A button of a notice card was pressed. On success the card closes (unless the user cancelled a
/// dialog); on failure the error comes back so the card can say so and stay.
#[tauri::command]
pub async fn quick_access_notice_action(
    app: AppHandle,
    id: String,
    index: usize,
) -> Result<(), String> {
    use super::notice::Handler;
    let handler = notice_handler(&app, &id, index).ok_or("This message is no longer available.")?;
    match handler {
        Handler::Dismiss => close(&app, &id),
        Handler::OpenSettings => {
            crate::tray::show_settings(&app);
            close(&app, &id);
        }
        Handler::CopyText(text) => {
            app.clipboard()
                .write_text(text)
                .map_err(|e| e.to_string())?;
            close(&app, &id);
        }
        Handler::CaptureAgain { mode, toolbar } => {
            close(&app, &id);
            crate::capture::flow::start(&app, mode, toolbar);
        }
        Handler::CopyAgain(path) => {
            copy_file_to_clipboard(&app, &path)?;
            close(&app, &id);
        }
        Handler::SaveAs(path) => {
            if save_copy(&app, &path)?.is_some() {
                close(&app, &id);
            }
        }
        Handler::Reveal(path) => {
            platform::reveal_file(&path);
            close(&app, &id);
        }
        Handler::RetrySave { frame, source } => {
            close(&app, &id);
            let frame = Arc::try_unwrap(frame).unwrap_or_else(|shared| (*shared).clone());
            crate::capture::output::deliver(&app, frame, source);
        }
        Handler::ChooseFolder { frame, source } => {
            let Some(folder) = app.dialog().file().blocking_pick_folder() else {
                return Ok(()); // cancelled: the card stays
            };
            let folder = folder.into_path().map_err(|e| e.to_string())?;
            close(&app, &id);
            let frame = Arc::try_unwrap(frame).unwrap_or_else(|shared| (*shared).clone());
            crate::capture::output::deliver_to(&app, frame, source, Some(folder));
        }
    }
    Ok(())
}
