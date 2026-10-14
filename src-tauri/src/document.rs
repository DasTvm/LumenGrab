//! `.lumengrab` documents on the native side: opening files (double-click, menu, command line),
//! one viewer window per document, and the file access the page is allowed to ask for.
//!
//! The format itself (container, schema, rendering) is TypeScript (`src/document`); this module only
//! moves bytes and guards paths. **A page never names a path itself.** It gets the one file of its
//! window by window label, and it may write only to a place the user just picked in a dialog (a
//! grant, valid for one document). So a damaged or hostile file cannot make the app read or
//! overwrite arbitrary files.

use std::{
    collections::{HashMap, HashSet},
    path::{Path, PathBuf},
    sync::{
        atomic::{AtomicU32, AtomicU64, Ordering},
        Mutex,
    },
};

use serde::{Deserialize, Serialize};
use tauri::{
    image::Image,
    ipc::{InvokeBody, Request, Response},
    AppHandle, CloseRequestApi, Emitter, Manager, WebviewUrl, WebviewWindowBuilder, Window,
};
use tauri_plugin_clipboard_manager::ClipboardExt;
use tauri_plugin_dialog::DialogExt;

use crate::{fsutil, platform};

const EXTENSION: &str = "lumengrab";
const WINDOW_PREFIX: &str = "doc-";
/// 512 MB of content (docs/FORMAT.md) plus the container's own overhead.
const MAX_DOCUMENT_BYTES: u64 = 600 * 1024 * 1024;
/// The largest picture accepted as a presentation background.
const MAX_IMAGE_BYTES: u64 = 20 * 1024 * 1024;
/// Open save grants at once. A page that asks for more loses the oldest.
const MAX_GRANTS: usize = 16;
/// The only web address the app opens for the page ("Check for updates" of the read-only dialog).
pub const RELEASES_URL: &str = "https://github.com/DasTvm/LumenGrab/releases";

/// What a document window shows.
#[derive(Clone, Debug, PartialEq, Eq)]
enum Source {
    /// A `.lumengrab` file on disk: the window edits and saves it.
    File(PathBuf),
    /// A screenshot (PNG) that is not a document yet ("Edit" in Quick Access): the first save asks where.
    Capture(PathBuf),
    /// Unsaved work found after a crash (a `.lumengrab` in the recovery folder), with the name it had.
    Recovered { path: PathBuf, name: String },
}

impl Source {
    /// The file the page reads its bytes from.
    fn read_path(&self) -> &Path {
        match self {
            Self::File(p) | Self::Capture(p) | Self::Recovered { path: p, .. } => p,
        }
    }

    fn kind(&self) -> &'static str {
        match self {
            Self::File(_) => "file",
            Self::Capture(_) => "capture",
            Self::Recovered { .. } => "recovered",
        }
    }
}

#[derive(Default)]
struct Registry {
    /// Window label -> what that window shows.
    windows: HashMap<String, Source>,
    /// Windows with changes that are not saved: closing them asks first.
    dirty: HashSet<String>,
    /// Save token -> the place the user picked in a dialog. Kept in order, oldest first.
    grants: Vec<(u64, PathBuf)>,
    /// Save token -> a file that was written to that place, so the page can ask to show it.
    written: Vec<(u64, PathBuf)>,
}

impl Registry {
    fn register(&mut self, label: &str, source: Source) {
        self.windows.insert(label.to_owned(), source);
    }

    fn source_of(&self, label: &str) -> Option<&Source> {
        self.windows.get(label)
    }

    /// The `.lumengrab` file of a window, if it is one that was saved (or opened from disk).
    fn path_of(&self, label: &str) -> Option<&Path> {
        match self.windows.get(label) {
            Some(Source::File(p)) => Some(p),
            _ => None,
        }
    }

    fn unregister(&mut self, label: &str) {
        self.windows.remove(label);
        self.dirty.remove(label);
    }

    fn find_source(&self, source: &Source) -> Option<&str> {
        self.windows
            .iter()
            .find(|(_, s)| *s == source)
            .map(|(label, _)| label.as_str())
    }

    fn set_dirty(&mut self, label: &str, dirty: bool) {
        if !self.windows.contains_key(label) {
            return;
        }
        if dirty {
            self.dirty.insert(label.to_owned());
        } else {
            self.dirty.remove(label);
        }
    }

    fn is_dirty(&self, label: &str) -> bool {
        self.dirty.contains(label)
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

    /// Uses up a grant after the file was written, and remembers the file for "Show".
    fn consume(&mut self, token: u64) {
        if let Some(at) = self.grants.iter().position(|(t, _)| *t == token) {
            let (token, path) = self.grants.remove(at);
            self.written.push((token, path));
            if self.written.len() > MAX_GRANTS {
                self.written.remove(0);
            }
        }
    }

    fn written_path(&self, token: u64) -> Option<&Path> {
        self.written
            .iter()
            .find(|(t, _)| *t == token)
            .map(|(_, p)| p.as_path())
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

/// Opens the editor window for a document file, or brings the one that already shows it to the front.
/// Returns the window label. Not for the command thread of a sync command (it waits for the main thread).
pub fn open(app: &AppHandle, path: &Path) -> Result<String, String> {
    if !is_document_file(path) {
        return Err("This is not a LumenGrab document.".into());
    }
    let path = std::fs::canonicalize(path).unwrap_or_else(|_| path.to_path_buf());
    open_source(app, Source::File(path))
}

/// The editor for a screenshot that is not a document yet (the "Edit" button of Quick Access).
pub fn open_capture(app: &AppHandle, png: &Path) -> Result<String, String> {
    if !png.is_file() {
        return Err("This screenshot is no longer available.".into());
    }
    open_source(app, Source::Capture(png.to_path_buf()))
}

/// The editor for work saved by the autosave of a session that did not end cleanly.
pub fn open_recovered(app: &AppHandle, path: PathBuf, name: String) -> Result<String, String> {
    open_source(app, Source::Recovered { path, name })
}

fn open_source(app: &AppHandle, source: Source) -> Result<String, String> {
    let docs = app.state::<Documents>();
    let existing = docs.registry().find_source(&source).map(str::to_owned);
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
    let title = window_title(&source);
    docs.registry().register(&label, source);
    let built = WebviewWindowBuilder::new(
        app,
        &label,
        WebviewUrl::App(format!("index.html?window=document&label={label}").into()),
    )
    .title(title)
    // The editor (tool rail, canvas, panel) is laid out for 1280 x 880; smaller screens may shrink it.
    .inner_size(1280.0, 880.0)
    .min_inner_size(960.0, 640.0)
    .center()
    .build();
    match built {
        Ok(window) => {
            platform::update_dock_presence(app, None);
            let _ = window.set_focus();
            Ok(label)
        }
        Err(e) => {
            docs.registry().unregister(&label);
            Err(e.to_string())
        }
    }
}

fn window_title(source: &Source) -> String {
    let name = match source {
        Source::Recovered { name, .. } => name.clone(),
        other => other
            .read_path()
            .file_name()
            .map_or_else(|| "LumenGrab".into(), |n| n.to_string_lossy().into_owned()),
    };
    name
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
        // An update waiting for the last unsaved document to be dealt with can go ahead now.
        crate::updates_ui::after_document_closed(app);
    }
}

/// The user answered "Cancel" to "Save changes?": an update restart that was waiting for that is off.
#[tauri::command]
pub fn document_close_cancelled(app: AppHandle) {
    crate::updates_ui::cancel_pending_restart(&app);
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DocumentInfo {
    file_name: String,
    /// The folder, as shown to the user.
    folder: String,
    /// `file` (a `.lumengrab` on disk), `capture` (a screenshot to edit; the first save asks where) or
    /// `recovered` (unsaved work from the last session).
    kind: &'static str,
    /// The screenshot is a kept original (from before the automatic look): the editor puts the look on.
    apply_look: bool,
}

fn source_of(app: &AppHandle, label: &str) -> Result<Source, String> {
    app.state::<Documents>()
        .registry()
        .source_of(label)
        .cloned()
        .ok_or_else(|| "This document window is no longer available.".to_string())
}

/// The `.lumengrab` file of a window. Errors for a window that has no file yet.
fn window_path(app: &AppHandle, label: &str) -> Result<PathBuf, String> {
    app.state::<Documents>()
        .registry()
        .path_of(label)
        .map(Path::to_path_buf)
        .ok_or_else(|| "This document has not been saved yet.".to_string())
}

/// The name a window shows for its document.
fn display_name(source: &Source) -> String {
    match source {
        Source::Recovered { name, .. } => name.clone(),
        Source::Capture(p) => p
            .file_stem()
            .map(|n| n.to_string_lossy().into_owned())
            .unwrap_or_default(),
        Source::File(p) => p
            .file_name()
            .map(|n| n.to_string_lossy().into_owned())
            .unwrap_or_default(),
    }
}

/// A document window with changes that are not saved.
#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DirtyDocument {
    pub label: String,
    pub name: String,
    /// `file`, `capture` or `recovered`.
    pub kind: &'static str,
}

/// The documents that would lose work if the app quit now (the update restart lists them).
pub fn dirty_documents(app: &AppHandle) -> Vec<DirtyDocument> {
    let docs = app.state::<Documents>();
    let registry = docs.registry();
    let mut out: Vec<DirtyDocument> = registry
        .windows
        .iter()
        .filter(|(label, _)| registry.is_dirty(label))
        .map(|(label, source)| DirtyDocument {
            label: label.clone(),
            name: display_name(source),
            kind: source.kind(),
        })
        .collect();
    out.sort_by(|a, b| a.label.cmp(&b.label));
    out
}

#[tauri::command]
pub fn document_info(app: AppHandle, label: String) -> Result<DocumentInfo, String> {
    let source = source_of(&app, &label)?;
    let path = source.read_path();
    let file_name = display_name(&source);
    Ok(DocumentInfo {
        file_name,
        folder: crate::quick_access::short_folder(path),
        kind: source.kind(),
        apply_look: matches!(source, Source::Capture(_)) && crate::present::is_original(&app, path),
    })
}

/// The bytes of the window's document, as raw binary (not JSON): the `.lumengrab` file, or the PNG of a
/// screenshot that is being edited. Async: it may be a big file.
#[tauri::command]
pub async fn document_load(app: AppHandle, label: String) -> Result<Response, String> {
    let source = source_of(&app, &label)?;
    let path = source.read_path();
    let size = std::fs::metadata(path)
        .map_err(|e| format!("{}: {e}", path.display()))?
        .len();
    if size > MAX_DOCUMENT_BYTES {
        return Err("This file is too large to open safely.".into());
    }
    let bytes = std::fs::read(path).map_err(|e| format!("{}: {e}", path.display()))?;
    Ok(Response::new(bytes))
}

#[tauri::command]
pub fn document_reveal(app: AppHandle, label: String) -> Result<(), String> {
    platform::reveal_file(&window_path(&app, &label)?);
    Ok(())
}

/// Closes the window of a document (the "Close" button of the error dialog, or "Don't save").
#[tauri::command]
pub fn document_close(app: AppHandle, label: String) {
    if label.starts_with(WINDOW_PREFIX) {
        if let Some(window) = app.get_webview_window(&label) {
            let _ = window.destroy();
        }
    }
}

/// Saves the document to the file it was opened from (Cmd/Ctrl+S). The request body is the file; the
/// `label` header names the window, so a page can only ever overwrite its own file. Atomic: the old file
/// stays until the new one is complete. Untitled documents go through `pick_save_target` first.
#[tauri::command]
pub async fn document_save(app: AppHandle, request: Request<'_>) -> Result<(), String> {
    let label = request
        .headers()
        .get("label")
        .and_then(|v| v.to_str().ok())
        .ok_or("The document is unknown.")?
        .to_owned();
    let InvokeBody::Raw(bytes) = request.body() else {
        return Err("No file data was sent.".into());
    };
    if bytes.len() as u64 > MAX_DOCUMENT_BYTES {
        return Err("This file is too large to save.".into());
    }
    let path = window_path(&app, &label)?;
    fsutil::write_atomic(&path, bytes).map_err(|e| format!("{}: {e}", path.display()))
}

/// After a document was written through a save dialog (a grant of the kind `pick_save_target` hands
/// out), the window is that file from now on: the next Cmd/Ctrl+S saves there, its title follows.
#[tauri::command]
pub fn document_bind_saved(app: AppHandle, label: String, token: String) -> Result<(), String> {
    let token: u64 = token.parse().map_err(|_| "The saved file is unknown.")?;
    let docs = app.state::<Documents>();
    let path = {
        let registry = docs.registry();
        if registry.source_of(&label).is_none() {
            return Err("This document window is no longer available.".into());
        }
        registry
            .written_path(token)
            .map(Path::to_path_buf)
            .ok_or("The saved file is unknown.")?
    };
    if path
        .extension()
        .is_none_or(|e| !e.eq_ignore_ascii_case(EXTENSION))
    {
        return Err("Only a .lumengrab file can become the file of a document.".into());
    }
    let source = Source::File(path);
    if let Some(window) = app.get_webview_window(&label) {
        let _ = window.set_title(&window_title(&source));
    }
    docs.registry().register(&label, source);
    Ok(())
}

/// The page tells whether the document has unsaved changes. A window with changes does not close
/// without asking (see `on_close_requested`).
#[tauri::command]
pub fn document_set_dirty(app: AppHandle, label: String, dirty: bool) {
    app.state::<Documents>().registry().set_dirty(&label, dirty);
}

/// The window is being closed (red button, Cmd/Alt+W). A document with unsaved changes stays open and asks the page,
/// which shows "Save changes to …?" and closes the window with `document_close` once the user decided.
pub fn on_close_requested(window: &Window, api: &CloseRequestApi) {
    let label = window.label();
    if !label.starts_with(WINDOW_PREFIX) {
        return;
    }
    let dirty = window.state::<Documents>().registry().is_dirty(label);
    if dirty {
        api.prevent_close();
        let _ = window.emit("document-close-requested", label.to_owned());
    }
}

/// WebP, lossy, from raw RGBA pixels (the request body; `width`, `height` and `quality` 1-100 as headers).
/// The system WebView of macOS cannot encode WebP, so the encoder (libwebp) lives here.
#[tauri::command]
pub async fn encode_webp(request: Request<'_>) -> Result<Response, String> {
    let header = |name: &str| -> Option<u32> {
        request
            .headers()
            .get(name)
            .and_then(|v| v.to_str().ok())
            .and_then(|v| v.parse().ok())
    };
    let (width, height, quality) = (
        header("width").ok_or("The image size is missing.")?,
        header("height").ok_or("The image size is missing.")?,
        header("quality").unwrap_or(85).clamp(1, 100),
    );
    let InvokeBody::Raw(rgba) = request.body() else {
        return Err("No image data was sent.".into());
    };
    encode_webp_rgba(rgba, width, height, quality).map(Response::new)
}

fn encode_webp_rgba(rgba: &[u8], width: u32, height: u32, quality: u32) -> Result<Vec<u8>, String> {
    const MAX_EDGE: u32 = 16384; // the limit of the WebP format
    if width == 0 || height == 0 || width > MAX_EDGE || height > MAX_EDGE {
        return Err("This size cannot be saved as WebP.".into());
    }
    if rgba.len() as u64 != u64::from(width) * u64::from(height) * 4 {
        return Err("The image data does not match its size.".into());
    }
    let encoded = webp::Encoder::from_rgba(rgba, width, height).encode(quality as f32);
    Ok(encoded.to_vec())
}

/// The font families installed on this device, sorted, for the text tool's font list. Read once per run
/// (loading the system fonts takes a moment); a font installed later shows up after a restart.
#[tauri::command]
pub async fn list_system_fonts() -> Vec<String> {
    static FAMILIES: std::sync::OnceLock<Vec<String>> = std::sync::OnceLock::new();
    FAMILIES.get_or_init(system_font_families).clone()
}

fn system_font_families() -> Vec<String> {
    let mut db = fontdb::Database::new();
    db.load_system_fonts();
    let mut families: Vec<String> = db
        .faces()
        .filter_map(|face| face.families.first().map(|(name, _)| name.clone()))
        // Names that start with a dot are the system's private UI fonts (".SF NS"): not for the user.
        .filter(|name| !name.is_empty() && !name.starts_with('.'))
        .collect();
    families.sort_by_key(|name| name.to_lowercase());
    families.dedup();
    families
}

/// Puts a PNG (the request body) on the clipboard: the top bar's copy button and the Export dialog's Copy.
#[tauri::command]
pub async fn copy_png_to_clipboard(app: AppHandle, request: Request<'_>) -> Result<(), String> {
    let InvokeBody::Raw(bytes) = request.body() else {
        return Err("No image data was sent.".into());
    };
    let frame = crate::capture::encode::decode_png(bytes).map_err(|e| e.to_string())?;
    let image = Image::new(&frame.rgba, frame.width, frame.height);
    app.clipboard()
        .write_image(&image)
        .map_err(|e| e.to_string())
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

/// A dialog to pick a picture for a presentation background. The reply is the file's bytes as raw binary,
/// or an empty body if the user cancelled. The page never learns the path; it decodes and stores the
/// bytes inside the document. Dev builds can skip the dialog with `LUMENGRAB_DEV_IMAGE`.
#[tauri::command]
pub async fn pick_image(app: AppHandle) -> Result<Response, String> {
    #[cfg(any(debug_assertions, feature = "dev-hooks"))]
    let dev_image = std::env::var("LUMENGRAB_DEV_IMAGE").ok().map(PathBuf::from);
    #[cfg(not(any(debug_assertions, feature = "dev-hooks")))]
    let dev_image: Option<PathBuf> = None;
    let path = match dev_image {
        Some(path) => path,
        None => {
            let picked = app
                .dialog()
                .file()
                .add_filter("Picture", &["png", "jpg", "jpeg", "webp"])
                .blocking_pick_file();
            match picked.and_then(|p| p.into_path().ok()) {
                Some(path) => path,
                None => return Ok(Response::new(Vec::new())),
            }
        }
    };
    let size = std::fs::metadata(&path)
        .map_err(|e| format!("{}: {e}", path.display()))?
        .len();
    if size > MAX_IMAGE_BYTES {
        return Err("This picture is larger than 20 MB.".into());
    }
    let bytes = std::fs::read(&path).map_err(|e| format!("{}: {e}", path.display()))?;
    Ok(Response::new(bytes))
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SaveTarget {
    /// Pass this back to `write_granted_file`.
    token: String,
    /// The place the user picked, for showing in the UI.
    folder: String,
    file_name: String,
    /// `png`, `jpg`, `webp` or `lumengrab`, from the file extension.
    format: String,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SaveOptions {
    suggested_name: String,
    /// The formats the dialog offers, first is the default: `png`, `jpg`, `webp`, `lumengrab`.
    formats: Vec<String>,
}

fn filter_for(format: &str) -> Option<(&'static str, &'static str)> {
    match format {
        "png" => Some(("PNG image", "png")),
        "jpg" => Some(("JPEG image", "jpg")),
        "webp" => Some(("WebP image", "webp")),
        "lumengrab" => Some(("LumenGrab document", "lumengrab")),
        _ => None,
    }
}

/// `path` with the extension of the chosen format; if the user typed another extension that is
/// not one of the offered formats, the default format's is appended.
fn with_format_extension(path: PathBuf, formats: &[&str]) -> (PathBuf, String) {
    let current = path
        .extension()
        .map(|e| e.to_string_lossy().to_ascii_lowercase())
        .map(|e| if e == "jpeg" { "jpg".to_owned() } else { e });
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
    // Dev builds can skip the dialog (it cannot be driven from a script): the path comes from the environment.
    #[cfg(any(debug_assertions, feature = "dev-hooks"))]
    let dev_target = std::env::var("LUMENGRAB_DEV_SAVE_TARGET")
        .ok()
        .map(PathBuf::from);
    #[cfg(not(any(debug_assertions, feature = "dev-hooks")))]
    let dev_target: Option<PathBuf> = None;
    let chosen = match dev_target {
        Some(path) => path,
        None => {
            let Some(chosen) = dialog.blocking_save_file() else {
                return Ok(None);
            };
            chosen.into_path().map_err(|e| e.to_string())?
        }
    };
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

/// Shows a file that `write_granted_file` wrote (by its save token) in Finder / Explorer.
#[tauri::command]
pub fn reveal_written_file(app: AppHandle, token: String) -> Result<(), String> {
    let token: u64 = token.parse().map_err(|_| "The saved file is unknown.")?;
    let path = app
        .state::<Documents>()
        .registry()
        .written_path(token)
        .map(Path::to_path_buf)
        .ok_or("The saved file is unknown.")?;
    platform::reveal_file(&path);
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
        r.register("doc-1", Source::File(p("/a/one.lumengrab")));
        r.register("doc-2", Source::File(p("/a/two.lumengrab")));
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
        r.register("doc-1", Source::File(p("/a/one.lumengrab")));
        let find =
            |r: &Registry, path: &str| r.find_source(&Source::File(p(path))).map(str::to_owned);
        assert_eq!(find(&r, "/a/one.lumengrab"), Some("doc-1".into()));
        assert_eq!(find(&r, "/a/other.lumengrab"), None);
    }

    #[test]
    fn a_screenshot_and_recovered_work_are_documents_without_a_file_yet() {
        let mut r = Registry::default();
        r.register("doc-1", Source::Capture(p("/pics/shot.png")));
        r.register(
            "doc-2",
            Source::Recovered {
                path: p("/rec/id.lumengrab"),
                name: "Checkout".into(),
            },
        );
        assert_eq!(r.path_of("doc-1"), None, "nothing to save to yet");
        assert_eq!(r.path_of("doc-2"), None);
        assert_eq!(r.source_of("doc-1").map(Source::kind), Some("capture"));
        assert_eq!(r.source_of("doc-2").map(Source::kind), Some("recovered"));
        // Both are read from their own file, which is not a place the page may write.
        assert_eq!(
            r.source_of("doc-2").map(|s| s.read_path()),
            Some(Path::new("/rec/id.lumengrab"))
        );
        // The same screenshot is opened in one window only.
        assert_eq!(
            r.find_source(&Source::Capture(p("/pics/shot.png"))),
            Some("doc-1")
        );
        // After a save the window is that file.
        r.register("doc-1", Source::File(p("/docs/shot.lumengrab")));
        assert_eq!(r.path_of("doc-1"), Some(Path::new("/docs/shot.lumengrab")));
    }

    #[test]
    fn a_window_with_unsaved_changes_is_remembered_until_it_is_clean_or_gone() {
        let mut r = Registry::default();
        r.register("doc-1", Source::File(p("/a/one.lumengrab")));
        assert!(!r.is_dirty("doc-1"));
        r.set_dirty("doc-1", true);
        assert!(r.is_dirty("doc-1"));
        r.set_dirty("doc-1", false);
        assert!(!r.is_dirty("doc-1"));
        r.set_dirty("doc-1", true);
        r.unregister("doc-1");
        assert!(
            !r.is_dirty("doc-1"),
            "a closed window is not dirty any more"
        );
        r.set_dirty("settings", true);
        assert!(
            !r.is_dirty("settings"),
            "only document windows can be dirty"
        );
    }

    #[test]
    fn a_save_grant_works_for_its_token_and_its_path_only_until_used() {
        let mut r = Registry::default();
        r.grant(1, p("/save/here.png"));
        assert_eq!(r.grant_path(1), Some(Path::new("/save/here.png")));
        assert_eq!(r.grant_path(2), None, "a guessed token gets nothing");
        r.consume(1);
        assert_eq!(r.grant_path(1), None, "used up");
        assert_eq!(
            r.written_path(1),
            Some(Path::new("/save/here.png")),
            "remembered for Show"
        );
        assert_eq!(r.written_path(2), None);
        r.consume(1); // using it up twice does nothing
        assert_eq!(r.written.len(), 1);
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
            (p("/x/shot.jpg.png"), "png".to_string()),
            "a format that was not offered is not accepted"
        );
        let images = ["jpg", "webp"];
        assert_eq!(
            with_format_extension(p("/x/shot.JPEG"), &images),
            (p("/x/shot.JPEG"), "jpg".to_string()),
            "jpeg is jpg"
        );
        assert_eq!(
            with_format_extension(p("/x/shot.webp"), &images),
            (p("/x/shot.webp"), "webp".to_string())
        );
        assert_eq!(
            with_format_extension(p("/x/shot.png"), &["lumengrab"]),
            (p("/x/shot.png.lumengrab"), "lumengrab".to_string()),
            "a format that was not offered is not accepted"
        );
    }

    #[test]
    fn webp_is_encoded_from_rgba_and_bad_input_is_refused() {
        let rgba: Vec<u8> = (0..16 * 8).flat_map(|i| [i as u8, 90, 200, 255]).collect();
        let webp = encode_webp_rgba(&rgba, 16, 8, 80).unwrap();
        assert_eq!(&webp[..4], b"RIFF");
        assert_eq!(&webp[8..12], b"WEBP");
        assert!(encode_webp_rgba(&rgba, 16, 9, 80).is_err(), "wrong size");
        assert!(encode_webp_rgba(&rgba, 0, 8, 80).is_err());
        assert!(encode_webp_rgba(&[], 20000, 1, 80).is_err(), "too large");
    }

    #[test]
    fn the_installed_font_list_is_sorted_unique_and_free_of_private_fonts() {
        let families = system_font_families();
        let mut sorted = families.clone();
        sorted.sort_by_key(|name| name.to_lowercase());
        sorted.dedup();
        assert_eq!(families, sorted);
        assert!(families
            .iter()
            .all(|f| !f.starts_with('.') && !f.is_empty()));
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
