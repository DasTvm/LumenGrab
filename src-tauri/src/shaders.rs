//! Your own shaders ("My shaders") and the documents whose custom shader code may run (docs/adr/0009).
//! Like the looks, the native side only stores text: the page validates it (Zod), so a damaged file
//! costs nothing here. Writes are atomic.

use std::{fs, path::PathBuf};

use serde::Serialize;
use tauri::{AppHandle, Emitter};

const MAX_JSON: usize = 2 * 1024 * 1024;
/// The two files, and the only names a page can ask for (so no path can be smuggled in).
const NAMES: [&str; 2] = ["my-shaders", "trusted"];

#[derive(Clone, Serialize)]
struct Changed {
    /// The window that made the change: its page ignores the event.
    source: String,
}

fn file(app: &AppHandle, name: &str) -> Result<PathBuf, String> {
    if !NAMES.contains(&name) {
        return Err("That is not one of the shader files.".into());
    }
    crate::settings::config_dir(app)
        .map(|d| d.join("shaders").join(format!("{name}.json")))
        .map_err(|e| e.to_string())
}

/// The text of one of the files, or an empty string if there is none yet.
#[tauri::command]
pub async fn shaders_load(app: AppHandle, name: String) -> Result<String, String> {
    let path = file(&app, &name)?;
    match fs::read_to_string(&path) {
        Ok(text) => Ok(text),
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => Ok(String::new()),
        Err(e) => Err(format!("{}: {e}", path.display())),
    }
}

/// Writes one of the files and tells the other windows (`shaders-changed`).
#[tauri::command]
pub async fn shaders_save(
    app: AppHandle,
    name: String,
    json: String,
    source: String,
) -> Result<(), String> {
    if json.len() > MAX_JSON {
        return Err("Your shaders are too large to save.".into());
    }
    let path = file(&app, &name)?;
    if let Some(dir) = path.parent() {
        fs::create_dir_all(dir).map_err(|e| format!("{}: {e}", dir.display()))?;
    }
    crate::fsutil::write_atomic(&path, json.as_bytes())
        .map_err(|e| format!("{}: {e}", path.display()))?;
    let _ = app.emit("shaders-changed", Changed { source });
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn only_the_two_known_names_are_files() {
        assert!(NAMES.contains(&"my-shaders"));
        assert!(NAMES.contains(&"trusted"));
        assert!(!NAMES.contains(&"../settings"));
        assert!(!NAMES.contains(&"looks"));
        assert!(!NAMES.contains(&""));
    }
}
