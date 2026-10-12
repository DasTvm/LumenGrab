//! The user's looks (docs/adr/0007): `looks.json` and the background pictures in `looks/assets/`.
//! The native side only stores text and bytes; the page validates them (Zod), so a damaged file costs
//! nothing here. Writes are atomic.

use std::{
    fs,
    path::{Path, PathBuf},
};

use serde::Serialize;
use tauri::{
    ipc::{InvokeBody, Request, Response},
    AppHandle, Emitter,
};

const MAX_LOOKS_JSON: usize = 2 * 1024 * 1024;
const MAX_ASSET_BYTES: usize = 20 * 1024 * 1024;

#[derive(Clone, Serialize)]
struct Changed {
    /// The window that made the change: its page ignores the event.
    source: String,
}

fn looks_dir(app: &AppHandle) -> Result<PathBuf, String> {
    crate::settings::config_dir(app)
        .map(|d| d.join("looks"))
        .map_err(|e| e.to_string())
}

/// `<64 hex digits>.png|jpg|webp`: the only names an asset can have, so no path can be smuggled in.
fn valid_asset_name(name: &str) -> bool {
    let Some((stem, ext)) = name.split_once('.') else {
        return false;
    };
    stem.len() == 64
        && stem
            .bytes()
            .all(|b| b.is_ascii_digit() || (b'a'..=b'f').contains(&b))
        && matches!(ext, "png" | "jpg" | "webp")
}

fn assets_dir(dir: &Path) -> PathBuf {
    dir.join("assets")
}

/// `looks.json`, or an empty string if there is none yet.
#[tauri::command]
pub async fn looks_load(app: AppHandle) -> Result<String, String> {
    let path = looks_dir(&app)?.join("looks.json");
    match fs::read_to_string(&path) {
        Ok(text) => Ok(text),
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => Ok(String::new()),
        Err(e) => Err(format!("{}: {e}", path.display())),
    }
}

/// Writes `looks.json` and tells the other windows (`looks-changed`).
#[tauri::command]
pub async fn looks_save(app: AppHandle, json: String, source: String) -> Result<(), String> {
    if json.len() > MAX_LOOKS_JSON {
        return Err("Your looks are too large to save.".into());
    }
    let dir = looks_dir(&app)?;
    fs::create_dir_all(&dir).map_err(|e| format!("{}: {e}", dir.display()))?;
    let path = dir.join("looks.json");
    crate::fsutil::write_atomic(&path, json.as_bytes())
        .map_err(|e| format!("{}: {e}", path.display()))?;
    let _ = app.emit("looks-changed", Changed { source });
    Ok(())
}

/// The bytes of a background picture, or an empty body if it is not there.
#[tauri::command]
pub async fn looks_read_asset(app: AppHandle, name: String) -> Result<Response, String> {
    if !valid_asset_name(&name) {
        return Err("That is not a picture of a look.".into());
    }
    let path = assets_dir(&looks_dir(&app)?).join(&name);
    match fs::read(&path) {
        Ok(bytes) => Ok(Response::new(bytes)),
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => Ok(Response::new(Vec::new())),
        Err(e) => Err(format!("{}: {e}", path.display())),
    }
}

/// Stores a background picture; the `name` header is its asset name, the body its bytes.
#[tauri::command]
pub async fn looks_write_asset(app: AppHandle, request: Request<'_>) -> Result<(), String> {
    let name = request
        .headers()
        .get("name")
        .and_then(|v| v.to_str().ok())
        .ok_or("The picture has no name.")?
        .to_owned();
    if !valid_asset_name(&name) {
        return Err("That is not a picture of a look.".into());
    }
    let InvokeBody::Raw(bytes) = request.body() else {
        return Err("No picture was sent.".into());
    };
    if bytes.len() > MAX_ASSET_BYTES {
        return Err("This picture is larger than 20 MB.".into());
    }
    let dir = assets_dir(&looks_dir(&app)?);
    fs::create_dir_all(&dir).map_err(|e| format!("{}: {e}", dir.display()))?;
    let path = dir.join(&name);
    crate::fsutil::write_atomic(&path, bytes).map_err(|e| format!("{}: {e}", path.display()))
}

/// Deletes the pictures that are not in `keep`.
#[tauri::command]
pub async fn looks_prune_assets(app: AppHandle, keep: Vec<String>) -> Result<(), String> {
    prune(&assets_dir(&looks_dir(&app)?), &keep)
}

fn prune(dir: &Path, keep: &[String]) -> Result<(), String> {
    let Ok(entries) = fs::read_dir(dir) else {
        return Ok(()); // no pictures yet
    };
    for entry in entries.flatten() {
        let name = entry.file_name().to_string_lossy().into_owned();
        if valid_asset_name(&name) && !keep.contains(&name) {
            let _ = fs::remove_file(entry.path());
        }
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    const HASH: &str = "0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef";

    #[test]
    fn accepts_only_hash_names() {
        assert!(valid_asset_name(&format!("{HASH}.png")));
        assert!(valid_asset_name(&format!("{HASH}.jpg")));
        assert!(valid_asset_name(&format!("{HASH}.webp")));
        assert!(!valid_asset_name(&format!("{HASH}.gif")));
        assert!(!valid_asset_name("../looks.json"));
        assert!(!valid_asset_name(&format!("../{HASH}.png")));
        assert!(!valid_asset_name(&format!("{}.png", HASH.to_uppercase())));
        assert!(!valid_asset_name("short.png"));
        assert!(!valid_asset_name(""));
    }

    #[test]
    fn prune_keeps_the_named_pictures_and_other_files() {
        let dir = std::env::temp_dir().join(format!("lumengrab-looks-{}", std::process::id()));
        let _ = fs::remove_dir_all(&dir);
        fs::create_dir_all(&dir).unwrap();
        let keep = format!("{HASH}.png");
        let drop = format!("{}.png", HASH.replace('0', "1"));
        fs::write(dir.join(&keep), b"a").unwrap();
        fs::write(dir.join(&drop), b"b").unwrap();
        fs::write(dir.join("notes.txt"), b"c").unwrap();
        prune(&dir, std::slice::from_ref(&keep)).unwrap();
        assert!(dir.join(&keep).exists());
        assert!(!dir.join(&drop).exists());
        assert!(
            dir.join("notes.txt").exists(),
            "files that are not pictures are left alone"
        );
        prune(&dir.join("missing"), &[]).unwrap();
        let _ = fs::remove_dir_all(&dir);
    }
}
