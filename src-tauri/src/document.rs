//! `.lumengrab` documents on the native side: opening files (double-click, menu, command line),
//! one viewer window per document, and the file access the page is allowed to ask for.
//!
//! The format itself (container, schema, rendering) is TypeScript (`src/document`); this module only
//! moves bytes and guards paths. **A page never names a path itself.** It gets the one file of its
//! window by window label, and it may write only to a place the user just picked in a dialog (a
//! grant, valid for one document). So a damaged or hostile file cannot make the app read or
//! overwrite arbitrary files.

use std::{
    collections::HashMap,
    path::{Path, PathBuf},
    sync::{
        atomic::{AtomicU32, AtomicU64, Ordering},
        Mutex,
    },
};

use serde::{Deserialize, Serialize};
use tauri::{
    ipc::{InvokeBody, Request, Response},
    AppHandle, Manager, WebviewUrl, WebviewWindowBuilder,
};
use tauri_plugin_dialog::DialogExt;

use crate::{fsutil, platform};

const EXTENSION: &str = "lumengrab";
const WINDOW_PREFIX: &str = "doc-";
/// 512 MB of content (docs/FORMAT.md) plus the container's own overhead.
const MAX_DOCUMENT_BYTES: u64 = 600 * 1024 * 1024;
/// Open save grants at once. A page that asks for more loses the oldest.
const MAX_GRANTS: usize = 16;
/// The only web address the app opens for the page ("Check for updates" of the read-only dialog).
pub const RELEASES_URL: &str = "https://github.com/DasTvm/LumenGrab/releases";

#[derive(Default)]
struct Registry {
    /// Window label -> the one file that window shows.
    windows: HashMap<String, PathBuf>,
    /// Save token -> the place the user picked in a dialog. Kept in order, oldest first.
    grants: Vec<(u64, PathBuf)>,
}

impl Registry {
    fn register(&mut self, label: &str, path: PathBuf) {
        self.windows.insert(label.to_owned(), path);
    }

    fn path_of(&self, label: &str) -> Option<&Path> {
        self.windows.get(label).map(PathBuf::as_path)
    }

    fn unregister(&mut self, label: &str) {
        self.windows.remove(label);
    }

    /// The window already showing `path`, if any.
    fn find_open(&self, path: &Path) -> Option<&str> {
        self.windows
            .iter()
            .find(|(_, p)| p.as_path() == path)
            .map(|(label, _)| label.as_str())
    }

    fn grant(&mut self, token: u64, path: PathBuf) {
        self.grants.push((token, path));
        if self.grants.len() > MAX_GRANTS {
            self.grants.remove(0);
        }
    }

    fn grant_path(&self, token: u64) -> Option<&Path> {
        self.grants
            .iter()
            .find(|(t, _)| *t == token)
            .map(|(_, p)| p.as_path())
    }

    /// Uses up a grant after the file was written.
    fn consume(&mut self, token: u64) {
        self.grants.retain(|(t, _)| *t != token);
    }
}

#[derive(Default)]
pub struct Documents {
    registry: Mutex<Registry>,
    windows: AtomicU32,
    tokens: AtomicU64,
}

impl Documents {
    fn registry(&self) -> std::sync::MutexGuard<'_, Registry> {
        self.registry.lock().expect("document registry")
    }
}

/// A regular file with the `.lumengrab` extension.
pub fn is_document_file(path: &Path) -> bool {
    path.extension()
        .is_some_and(|e| e.eq_ignore_ascii_case(EXTENSION))
        && path.is_file()
}

/// The documents among command-line arguments or URLs (`file://...`). Everything else is ignored:
/// flags, other files, paths that do not exist.
pub fn document_paths<I: IntoIterator<Item = String>>(args: I) -> Vec<PathBuf> {
    args.into_iter()
        .filter(|arg| !arg.is_empty() && !arg.starts_with('-'))
        .filter_map(|arg| {
            if arg.starts_with("file://") {
                tauri::Url::parse(&arg).ok()?.to_file_path().ok()
            } else {
                Some(PathBuf::from(arg))
            }
        })
        .filter(|p| is_document_file(p))
        .collect()
}

/// Opens every document among `args` (the first launch on Windows, or a second launch forwarded to
/// the running instance). Safe to call from any thread.
pub fn open_args<I: IntoIterator<Item = String>>(app: &AppHandle, args: I) {
    for path in document_paths(args) {
        if let Err(e) = open(app, &path) {
            eprintln!("[lumengrab] could not open {}: {e}", path.display());
        }
    }
}

/// Opens the viewer window for a document, or brings the one that already shows it to the front.
/// Returns the window label. Not for the command thread of a sync command (it waits for the main thread).
pub fn open(app: &AppHandle, path: &Path) -> Result<String, String> {
    if !is_document_file(path) {
        return Err("This is not a LumenGrab document.".into());
    }
    let docs = app.state::<Documents>();
    let path = std::fs::canonicalize(path).unwrap_or_else(|_| path.to_path_buf());
    let existing = docs.registry().find_open(&path).map(str::to_owned);
    if let Some(label) = existing {
        if let Some(window) = app.get_webview_window(&label) {
            let _ = window.show();
            let _ = window.set_focus();
            return Ok(label);
        }
        docs.registry().unregister(&label); // its window is gone
    }
    let label = format!(
        "{WINDOW_PREFIX}{}",
        docs.windows.fetch_add(1, Ordering::Relaxed) + 1
    );
    let title = path
        .file_name()
        .map_or_else(|| "LumenGrab".into(), |n| n.to_string_lossy().into_owned());
    docs.registry().register(&label, path);
    let built = WebviewWindowBuilder::new(
        app,
        &label,
        WebviewUrl::App(format!("index.html?window=document&label={label}").into()),
    )
    .title(title)
    .inner_size(980.0, 700.0)
    .min_inner_size(640.0, 480.0)
    .center()
    .build();
    match built {
        Ok(window) => {
            let _ = window.set_focus();
            Ok(label)
        }
        Err(e) => {
            docs.registry().unregister(&label);
            Err(e.to_string())
        }
    }
}

/// The tray's "Open Document…": asks for a file, then opens it. Blocks on the dialog: worker thread only.
pub fn pick_and_open(app: &AppHandle) {
    let picked = app
        .dialog()
        .file()
        .add_filter("LumenGrab document", &[EXTENSION])
        .blocking_pick_file();
    if let Some(path) = picked.and_then(|p| p.into_path().ok()) {
        if let Err(e) = open(app, &path) {
            crate::capture::output::error_dialog(app, &e);
        }
    }
}

/// A window with this label was destroyed.
pub fn on_destroyed(app: &AppHandle, label: &str) {
    if label.starts_with(WINDOW_PREFIX) {
        app.state::<Documents>().registry().unregister(label);
    }
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DocumentInfo {
    file_name: String,
    /// The folder, as shown to the user.
    folder: String,
}

fn window_path(app: &AppHandle, label: &str) -> Result<PathBuf, String> {
    app.state::<Documents>()
        .registry()
        .path_of(label)
        .map(Path::to_path_buf)
        .ok_or_else(|| "This document window is no longer available.".to_string())
}

#[tauri::command]
pub fn document_info(app: AppHandle, label: String) -> Result<DocumentInfo, String> {
    let path = window_path(&app, &label)?;
    Ok(DocumentInfo {
        file_name: path
            .file_name()
            .map(|n| n.to_string_lossy().into_owned())
            .unwrap_or_default(),
        folder: crate::quick_access::short_folder(&path),
    })
}

/// The bytes of the window's document, as raw binary (not JSON). Async: it may be a big file.
#[tauri::command]
pub async fn document_load(app: AppHandle, label: String) -> Result<Response, String> {
    let path = window_path(&app, &label)?;
    let size = std::fs::metadata(&path)
        .map_err(|e| format!("{}: {e}", path.display()))?
        .len();
    if size > MAX_DOCUMENT_BYTES {
        return Err("This file is too large to open safely.".into());
    }
    let bytes = std::fs::read(&path).map_err(|e| format!("{}: {e}", path.display()))?;
    Ok(Response::new(bytes))
}

#[tauri::command]
pub fn document_reveal(app: AppHandle, label: String) -> Result<(), String> {
    platform::reveal_file(&window_path(&app, &label)?);
    Ok(())
}

/// Closes the window of a document (the "Close" button of the error dialog).
#[tauri::command]
pub fn document_close(app: AppHandle, label: String) {
    if label.starts_with(WINDOW_PREFIX) {
        if let Some(window) = app.get_webview_window(&label) {
            let _ = window.destroy();
        }
    }
}

/// "Open…": a dialog, then the viewer window. Returns whether a document was opened.
#[tauri::command]
pub async fn document_pick_open(app: AppHandle) -> Result<bool, String> {
    let picked = app
        .dialog()
        .file()
        .add_filter("LumenGrab document", &[EXTENSION])
        .blocking_pick_file();
    match picked.and_then(|p| p.into_path().ok()) {
        Some(path) => open(&app, &path).map(|_| true),
        None => Ok(false),
    }
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SaveTarget {
    /// Pass this back to `write_granted_file`.
    token: String,
    /// The place the user picked, for showing in the UI.
    folder: String,
    file_name: String,
    /// `png` or `lumengrab`, from the file extension.
    format: String,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SaveOptions {
    suggested_name: String,
    /// The formats the dialog offers, first is the default: `png`, `lumengrab`.
    formats: Vec<String>,
}

fn filter_for(format: &str) -> Option<(&'static str, &'static str)> {
    match format {
        "png" => Some(("PNG image", "png")),
        "lumengrab" => Some(("LumenGrab document", "lumengrab")),
        _ => None,
    }
}

/// `path` with the extension of the chosen format; if the user typed another extension that is
/// not one of the offered formats, the default format's is appended.
fn with_format_extension(path: PathBuf, formats: &[&str]) -> (PathBuf, String) {
    let current = path
        .extension()
        .map(|e| e.to_string_lossy().to_ascii_lowercase());
    if let Some(ext) = &current {
        if formats.contains(&ext.as_str()) {
            return (path, ext.clone());
        }
    }
    let default = formats.first().copied().unwrap_or("png");
    let mut name = path.into_os_string();
    name.push(format!(".{default}"));
    (PathBuf::from(name), default.to_owned())
}

/// A save dialog. The chosen place becomes a one-time grant for `write_granted_file`.
#[tauri::command]
pub async fn pick_save_target(
    app: AppHandle,
    options: SaveOptions,
) -> Result<Option<SaveTarget>, String> {
    let formats: Vec<&str> = options.formats.iter().map(String::as_str).collect();
    if formats.is_empty() || formats.iter().any(|f| filter_for(f).is_none()) {
        return Err("Unknown file format.".into());
    }
    let mut dialog = app.dialog().file().set_file_name(options.suggested_name);
    for format in &formats {
        if let Some((name, ext)) = filter_for(format) {
            dialog = dialog.add_filter(name, &[ext]);
        }
    }
    let Some(chosen) = dialog.blocking_save_file() else {
        return Ok(None);
    };
    let chosen = chosen.into_path().map_err(|e| e.to_string())?;
    let (path, format) = with_format_extension(chosen, &formats);
    if path.is_dir() {
        return Err("That name is a folder.".into());
    }
    let docs = app.state::<Documents>();
    let token = docs.tokens.fetch_add(1, Ordering::Relaxed) + 1;
    docs.registry().grant(token, path.clone());
    Ok(Some(SaveTarget {
        token: token.to_string(),
        folder: crate::quick_access::short_folder(&path),
        file_name: path
            .file_name()
            .map(|n| n.to_string_lossy().into_owned())
            .unwrap_or_default(),
        format,
    }))
}

/// Writes the request body (raw bytes) to the place a dialog granted. The `token` header names the
/// grant; the file is written atomically; the grant is used up only once the write succeeded.
#[tauri::command]
pub async fn write_granted_file(app: AppHandle, request: Request<'_>) -> Result<(), String> {
    let token: u64 = request
        .headers()
        .get("token")
        .and_then(|v| v.to_str().ok())
        .and_then(|v| v.parse().ok())
        .ok_or("The save place is unknown.")?;
    let InvokeBody::Raw(bytes) = request.body() else {
        return Err("No file data was sent.".into());
    };
    if bytes.len() as u64 > MAX_DOCUMENT_BYTES {
        return Err("This file is too large to save.".into());
    }
    let docs = app.state::<Documents>();
    let path = docs
        .registry()
        .grant_path(token)
        .map(Path::to_path_buf)
        .ok_or("The save place is no longer valid. Choose it again.")?;
    fsutil::write_atomic(&path, bytes).map_err(|e| format!("{}: {e}", path.display()))?;
    docs.registry().consume(token);
    Ok(())
}

/// Whether the app may open this address for the page: only our own Releases page.
pub fn is_allowed_url(url: &str) -> bool {
    url == RELEASES_URL
        || url
            .strip_prefix(RELEASES_URL)
            .is_some_and(|rest| rest.starts_with('/'))
}

#[tauri::command]
pub fn open_url(url: String) -> Result<(), String> {
    if !is_allowed_url(&url) {
        return Err("This address cannot be opened from here.".into());
    }
    platform::open_url(&url);
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    fn p(s: &str) -> PathBuf {
        PathBuf::from(s)
    }

    #[test]
    fn a_window_may_read_only_its_own_file() {
        let mut r = Registry::default();
        r.register("doc-1", p("/a/one.lumengrab"));
        r.register("doc-2", p("/a/two.lumengrab"));
        assert_eq!(r.path_of("doc-1"), Some(Path::new("/a/one.lumengrab")));
        assert_eq!(r.path_of("doc-2"), Some(Path::new("/a/two.lumengrab")));
        assert_eq!(r.path_of("doc-3"), None, "an unknown window gets nothing");
        assert_eq!(r.path_of("settings"), None, "other windows get nothing");
        r.unregister("doc-1");
        assert_eq!(r.path_of("doc-1"), None);
    }

    #[test]
    fn the_same_file_is_found_again() {
        let mut r = Registry::default();
        r.register("doc-1", p("/a/one.lumengrab"));
        assert_eq!(r.find_open(Path::new("/a/one.lumengrab")), Some("doc-1"));
        assert_eq!(r.find_open(Path::new("/a/other.lumengrab")), None);
    }

    #[test]
    fn a_save_grant_works_for_its_token_and_its_path_only_until_used() {
        let mut r = Registry::default();
        r.grant(1, p("/save/here.png"));
        assert_eq!(r.grant_path(1), Some(Path::new("/save/here.png")));
        assert_eq!(r.grant_path(2), None, "a guessed token gets nothing");
        r.consume(1);
        assert_eq!(r.grant_path(1), None, "used up");
    }

    #[test]
    fn a_page_that_asks_for_many_grants_loses_the_oldest() {
        let mut r = Registry::default();
        for i in 0..(MAX_GRANTS as u64 + 5) {
            r.grant(i, p(&format!("/f{i}.png")));
        }
        assert_eq!(r.grants.len(), MAX_GRANTS);
        assert_eq!(r.grant_path(0), None);
        assert!(r.grant_path(MAX_GRANTS as u64 + 4).is_some());
    }

    #[test]
    fn only_existing_lumengrab_files_count_as_documents() {
        let dir = std::env::temp_dir().join(format!("lumengrab-doc-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&dir);
        std::fs::create_dir_all(&dir).unwrap();
        let good = dir.join("a.lumengrab");
        let upper = dir.join("B.LUMENGRAB");
        let other = dir.join("c.png");
        for f in [&good, &upper, &other] {
            std::fs::write(f, b"x").unwrap();
        }
        let folder_with_ext = dir.join("d.lumengrab");
        std::fs::create_dir(&folder_with_ext).unwrap();
        assert!(is_document_file(&good));
        assert!(
            is_document_file(&upper),
            "the extension is not case sensitive"
        );
        assert!(!is_document_file(&other));
        assert!(!is_document_file(&dir.join("missing.lumengrab")));
        assert!(
            !is_document_file(&folder_with_ext),
            "a folder is not a document"
        );

        let url = tauri::Url::from_file_path(&good).unwrap().to_string();
        let found = document_paths([
            "/usr/bin/lumengrab".to_string(), // not a document
            "--flag".into(),
            String::new(),
            good.display().to_string(),
            url,
            other.display().to_string(),
            "file:///definitely/not/here.lumengrab".into(),
        ]);
        assert_eq!(found, vec![good.clone(), good]);
    }

    #[test]
    fn the_save_dialog_result_gets_the_right_extension() {
        let formats = ["png", "lumengrab"];
        assert_eq!(
            with_format_extension(p("/x/shot.lumengrab"), &formats),
            (p("/x/shot.lumengrab"), "lumengrab".to_string())
        );
        assert_eq!(
            with_format_extension(p("/x/shot.PNG"), &formats),
            (p("/x/shot.PNG"), "png".to_string())
        );
        assert_eq!(
            with_format_extension(p("/x/shot"), &formats),
            (p("/x/shot.png"), "png".to_string())
        );
        assert_eq!(
            with_format_extension(p("/x/shot.jpg"), &formats),
            (p("/x/shot.jpg.png"), "png".to_string())
        );
        assert_eq!(
            with_format_extension(p("/x/shot.png"), &["lumengrab"]),
            (p("/x/shot.png.lumengrab"), "lumengrab".to_string()),
            "a format that was not offered is not accepted"
        );
    }

    #[test]
    fn only_the_releases_page_may_be_opened() {
        assert!(is_allowed_url(
            "https://github.com/DasTvm/LumenGrab/releases"
        ));
        assert!(is_allowed_url(
            "https://github.com/DasTvm/LumenGrab/releases/tag/v0.1.0"
        ));
        for bad in [
            "https://github.com/DasTvm/LumenGrab/releases-evil",
            "https://github.com/DasTvm/LumenGrab",
            "https://evil.example/https://github.com/DasTvm/LumenGrab/releases",
            "file:///etc/passwd",
            "javascript:alert(1)",
            "",
        ] {
            assert!(!is_allowed_url(bad), "{bad}");
        }
    }

    #[test]
    fn the_app_declares_the_lumengrab_file_association() {
        let conf: serde_json::Value =
            serde_json::from_str(include_str!("../tauri.conf.json")).unwrap();
        let assoc = &conf["bundle"]["fileAssociations"][0];
        assert_eq!(assoc["ext"][0], "lumengrab");
        assert_eq!(assoc["mimeType"], "application/vnd.lumengrab");
        assert_eq!(assoc["role"], "Editor");
        assert_eq!(
            assoc["exportedType"]["identifier"],
            "app.lumengrab.document"
        );
    }
}
