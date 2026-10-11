//! Recovery of unsaved work. The editor writes its document here a few seconds after every change
//! (`<id>.lumengrab` with a small `<id>.name` next to it), never over the user's own file. After a
//! crash or a power cut the files are still here, and the "Recover unsaved work" window offers them
//! (design: Recover unsaved work). A save or an explicit "Don't save" deletes them.
//!
//! Only the documents' ids touch the file system: a page names an id (letters, digits, `-`, `_`), never a path.

use std::{
    fs,
    path::{Path, PathBuf},
    time::UNIX_EPOCH,
};

use serde::Serialize;
use tauri::{
    ipc::{InvokeBody, Request, Response},
    AppHandle, Manager, WebviewUrl, WebviewWindowBuilder,
};

use crate::{document, fsutil};

const LABEL: &str = "recover";
const EXTENSION: &str = "lumengrab";
/// Same ceiling as documents (docs/FORMAT.md).
const MAX_BYTES: usize = 600 * 1024 * 1024;

/// `<app data>/recovery`. Dev builds can point it somewhere else (`LUMENGRAB_DEV_RECOVERY_DIR`).
fn dir(app: &AppHandle) -> Result<PathBuf, String> {
    #[cfg(any(debug_assertions, feature = "dev-hooks"))]
    if let Ok(dir) = std::env::var("LUMENGRAB_DEV_RECOVERY_DIR") {
        return Ok(dir.into());
    }
    app.path()
        .app_data_dir()
        .map(|p| p.join("recovery"))
        .map_err(|e| format!("The app data folder could not be found: {e}"))
}

/// A document id: what the format allows (1 to 64 characters), restricted to what is safe in a file name.
fn valid_id(id: &str) -> bool {
    !id.is_empty()
        && id.len() <= 64
        && id
            .chars()
            .all(|c| c.is_ascii_alphanumeric() || c == '-' || c == '_')
}

fn file_for(dir: &Path, id: &str) -> Result<PathBuf, String> {
    if !valid_id(id) {
        return Err("That document id is not valid.".into());
    }
    Ok(dir.join(format!("{id}.{EXTENSION}")))
}

fn name_for(dir: &Path, id: &str) -> PathBuf {
    dir.join(format!("{id}.name"))
}

/// Writes the recovery copy of a document. The `id` header names the document, the body is the `.lumengrab`.
#[tauri::command]
pub async fn recovery_write(app: AppHandle, request: Request<'_>) -> Result<(), String> {
    let id = request
        .headers()
        .get("id")
        .and_then(|v| v.to_str().ok())
        .ok_or("The document id is missing.")?
        .to_owned();
    let InvokeBody::Raw(bytes) = request.body() else {
        return Err("No file data was sent.".into());
    };
    if bytes.len() > MAX_BYTES {
        return Err("This file is too large.".into());
    }
    let dir = dir(&app)?;
    let target = file_for(&dir, &id)?;
    fs::create_dir_all(&dir).map_err(|e| format!("{}: {e}", dir.display()))?;
    fsutil::write_atomic(&target, bytes).map_err(|e| format!("{}: {e}", target.display()))
}

/// The name shown for a recovered document (the file name it had, or its capture's name).
#[tauri::command]
pub fn recovery_set_name(app: AppHandle, id: String, name: String) -> Result<(), String> {
    let dir = dir(&app)?;
    file_for(&dir, &id)?;
    fs::create_dir_all(&dir).map_err(|e| format!("{}: {e}", dir.display()))?;
    let name: String = name.chars().take(200).collect();
    fsutil::write_atomic(&name_for(&dir, &id), name.as_bytes()).map_err(|e| e.to_string())
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Recoverable {
    id: String,
    name: String,
    /// Milliseconds since 1970, when the copy was last written.
    modified_ms: u64,
    bytes: u64,
}

/// What is waiting to be recovered, newest first.
fn list(dir: &Path) -> Vec<Recoverable> {
    let Ok(entries) = fs::read_dir(dir) else {
        return Vec::new();
    };
    let mut found: Vec<Recoverable> = entries
        .filter_map(Result::ok)
        .filter_map(|entry| {
            let path = entry.path();
            if path.extension()?.to_str()? != EXTENSION {
                return None;
            }
            let id = path.file_stem()?.to_str()?.to_owned();
            if !valid_id(&id) {
                return None;
            }
            let meta = entry.metadata().ok()?;
            let modified_ms = meta
                .modified()
                .ok()?
                .duration_since(UNIX_EPOCH)
                .ok()?
                .as_millis()
                .try_into()
                .ok()?;
            let name = fs::read_to_string(name_for(dir, &id))
                .ok()
                .filter(|n| !n.trim().is_empty())
                .unwrap_or_else(|| "Unsaved capture".into());
            Some(Recoverable {
                id,
                name,
                modified_ms,
                bytes: meta.len(),
            })
        })
        .collect();
    found.sort_by_key(|r| std::cmp::Reverse(r.modified_ms));
    found
}

#[tauri::command]
pub fn recovery_list(app: AppHandle) -> Result<Vec<Recoverable>, String> {
    Ok(list(&dir(&app)?))
}

#[tauri::command]
pub async fn recovery_read(app: AppHandle, id: String) -> Result<Response, String> {
    let path = file_for(&dir(&app)?, &id)?;
    let bytes = fs::read(&path).map_err(|e| format!("{}: {e}", path.display()))?;
    Ok(Response::new(bytes))
}

/// Removes the recovery copies (after a save, or "Discard"). A missing one is not an error.
#[tauri::command]
pub fn recovery_delete(app: AppHandle, ids: Vec<String>) -> Result<(), String> {
    let dir = dir(&app)?;
    for id in ids {
        let file = file_for(&dir, &id)?;
        let _ = fs::remove_file(file);
        let _ = fs::remove_file(name_for(&dir, &id));
    }
    Ok(())
}

/// "Recover": opens each chosen copy as an unsaved document in its own editor window, then closes the dialog.
/// The recovery files stay until the user saves (or throws the work away).
#[tauri::command]
pub async fn recovery_open(app: AppHandle, ids: Vec<String>) -> Result<(), String> {
    let dir = dir(&app)?;
    for id in ids {
        let path = file_for(&dir, &id)?;
        let name = list(&dir)
            .into_iter()
            .find(|r| r.id == id)
            .map_or_else(|| "Recovered capture".into(), |r| r.name);
        document::open_recovered(&app, path, name)?;
    }
    if let Some(window) = app.get_webview_window(LABEL) {
        let _ = window.destroy();
    }
    Ok(())
}

#[tauri::command]
pub fn recovery_close(app: AppHandle) {
    if let Some(window) = app.get_webview_window(LABEL) {
        let _ = window.destroy();
    }
}

/// Opens the "Recover unsaved work" window, or brings it to the front.
pub fn show(app: &AppHandle) {
    if let Some(window) = app.get_webview_window(LABEL) {
        let _ = window.show();
        let _ = window.set_focus();
        return;
    }
    let result = WebviewWindowBuilder::new(
        app,
        LABEL,
        WebviewUrl::App("index.html?window=recover".into()),
    )
    .title("Recover unsaved work")
    .inner_size(560.0, 560.0)
    .min_inner_size(480.0, 420.0)
    .minimizable(false)
    .center()
    .build();
    match result {
        Ok(window) => {
            crate::platform::update_dock_presence(app, None);
            let _ = window.set_focus();
        }
        Err(e) => eprintln!("failed to open the recovery window: {e}"),
    }
}

/// At startup: if work was left behind, offer it. Waits a moment so the tray is up first.
pub fn offer_at_startup(app: &AppHandle) {
    let app = app.clone();
    std::thread::spawn(move || {
        std::thread::sleep(std::time::Duration::from_millis(1800));
        if dir(&app).is_ok_and(|d| !list(&d).is_empty()) {
            show(&app);
        }
    });
}

#[cfg(test)]
mod tests {
    use super::*;

    fn temp_dir(name: &str) -> PathBuf {
        let dir =
            std::env::temp_dir().join(format!("lumengrab-recovery-{name}-{}", std::process::id()));
        let _ = fs::remove_dir_all(&dir);
        fs::create_dir_all(&dir).unwrap();
        dir
    }

    #[test]
    fn only_plain_ids_name_files() {
        for good in ["abc", "A-1_b", "0b6e5b3a-8c1f-4d0e-9a52-1f3c2d4e5f60"] {
            assert!(valid_id(good), "{good}");
        }
        for bad in [
            "",
            "../x",
            "a/b",
            "a\\b",
            "a.b",
            "a b",
            &"x".repeat(65),
            "é",
        ] {
            assert!(!valid_id(bad), "{bad}");
        }
        assert!(file_for(Path::new("/r"), "../etc").is_err());
        assert_eq!(
            file_for(Path::new("/r"), "id1").unwrap(),
            PathBuf::from("/r/id1.lumengrab")
        );
    }

    #[test]
    fn lists_documents_with_their_names_newest_first_and_ignores_the_rest() {
        let dir = temp_dir("list");
        fs::write(dir.join("old.lumengrab"), b"x").unwrap();
        std::thread::sleep(std::time::Duration::from_millis(20));
        fs::write(dir.join("new.lumengrab"), b"xyz").unwrap();
        fs::write(name_for(&dir, "new"), "Checkout_error").unwrap();
        fs::write(dir.join("notes.txt"), b"x").unwrap();
        fs::write(dir.join("bad name.lumengrab"), b"x").unwrap();
        let found = list(&dir);
        assert_eq!(
            found.iter().map(|r| r.id.as_str()).collect::<Vec<_>>(),
            ["new", "old"]
        );
        assert_eq!(found[0].name, "Checkout_error");
        assert_eq!(found[0].bytes, 3);
        assert_eq!(
            found[1].name, "Unsaved capture",
            "no name file: a neutral name"
        );
        assert!(
            list(&dir.join("nope")).is_empty(),
            "no folder: nothing to recover"
        );
    }
}
