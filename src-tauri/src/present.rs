//! The automatic look (docs/adr/0007): a new screenshot is handed to a hidden page that draws the default
//! look with the very code the editor and the export use, and hands the finished PNG back. The native
//! side does no image processing; it only moves bytes and waits, with a timeout, so a capture is never
//! held up for long or lost: if the page does not answer, the screenshot goes out as it is.
//!
//! The original (the capture before the look) is kept in `originals/` for 30 days, so "Edit" can open it
//! and put the look on as a presentation (nothing is framed twice).

use std::{
    collections::HashMap,
    fs,
    path::{Path, PathBuf},
    sync::{
        atomic::{AtomicBool, AtomicU64, Ordering},
        mpsc, Arc, Mutex,
    },
    time::{Duration, SystemTime},
};

use tauri::{
    ipc::{InvokeBody, Request, Response},
    AppHandle, Emitter, Manager, WebviewUrl, WebviewWindowBuilder,
};

use crate::{
    capture::Frame,
    settings::{self, Settings},
};

/// The label of the hidden page that draws the look.
pub const LABEL: &str = "present";
const READY_TIMEOUT: Duration = Duration::from_secs(4);
const RESULT_TIMEOUT: Duration = Duration::from_secs(6);
/// Originals older than this are removed at startup.
pub const KEEP_ORIGINALS: Duration = Duration::from_secs(30 * 24 * 60 * 60);

/// A picture as raw RGBA bytes: PNG coding on both sides would cost more than the look itself.
struct Pending {
    original: Arc<Vec<u8>>,
    reply: mpsc::Sender<Result<Frame, String>>,
}

/// What the hidden page is told about a request (the pixels follow through `present_take`).
#[derive(Clone, serde::Serialize)]
struct PresentRequest {
    id: u64,
    width: u32,
    height: u32,
}

#[derive(Default)]
pub struct Presenter {
    /// The hidden page loaded and listens for requests.
    ready: AtomicBool,
    next: AtomicU64,
    pending: Mutex<HashMap<u64, Pending>>,
}

pub fn init(app: &AppHandle) {
    app.manage(Presenter::default());
    let settings = app.state::<settings::SettingsStore>().get();
    if settings.presentation.auto {
        let _ = ensure_window(app);
    }
    cleanup_originals_in_background(app);
}

/// Creates the hidden page once (it stays loaded, so the first look is as fast as the next).
fn ensure_window(app: &AppHandle) -> Result<(), String> {
    if app.get_webview_window(LABEL).is_some() {
        return Ok(());
    }
    WebviewWindowBuilder::new(
        app,
        LABEL,
        WebviewUrl::App("index.html?window=present".into()),
    )
    .title("LumenGrab")
    .visible(false)
    .focused(false)
    .decorations(false)
    .skip_taskbar(true)
    .inner_size(64.0, 64.0)
    .build()
    .map(|_| ())
    .map_err(|e| e.to_string())
}

/// The settings changed: the page is kept ready while the automatic look is on, and closed when it is off.
pub fn on_settings_changed(app: &AppHandle, settings: &Settings) {
    if settings.presentation.auto {
        let _ = ensure_window(app);
    } else if let Some(window) = app.get_webview_window(LABEL) {
        let _ = window.destroy();
    }
}

pub fn on_destroyed(app: &AppHandle, label: &str) {
    if label == LABEL {
        if let Some(presenter) = app.try_state::<Presenter>() {
            presenter.ready.store(false, Ordering::SeqCst);
        }
    }
}

/// Draws the default look on `original` and returns the finished picture. Blocks until the page
/// answers or the time is up: call it from a worker thread, never from the main thread.
pub fn present(app: &AppHandle, original: &Frame) -> Result<Frame, String> {
    let presenter = app.state::<Presenter>();
    ensure_window(app)?;
    let started = std::time::Instant::now();
    while !presenter.ready.load(Ordering::SeqCst) {
        if started.elapsed() > READY_TIMEOUT {
            return Err("The page that draws the look did not start.".into());
        }
        std::thread::sleep(Duration::from_millis(20));
    }
    let id = presenter.next.fetch_add(1, Ordering::SeqCst) + 1;
    let (reply, wait) = mpsc::channel();
    presenter
        .pending
        .lock()
        .map_err(|_| "internal error")?
        .insert(
            id,
            Pending {
                original: Arc::new(original.rgba.clone()),
                reply,
            },
        );
    let result = app
        .emit_to(
            LABEL,
            "present-request",
            PresentRequest {
                id,
                width: original.width,
                height: original.height,
            },
        )
        .map_err(|e| e.to_string())
        .and_then(|()| {
            wait.recv_timeout(RESULT_TIMEOUT)
                .map_err(|_| "Drawing the look took too long.".to_string())?
        });
    if let Ok(mut pending) = presenter.pending.lock() {
        pending.remove(&id);
    }
    result
}

/// The hidden page listens now.
#[tauri::command]
pub fn present_ready(presenter: tauri::State<Presenter>) {
    presenter.ready.store(true, Ordering::SeqCst);
}

/// The picture a request is about, as raw RGBA bytes.
#[tauri::command]
pub async fn present_take(
    presenter: tauri::State<'_, Presenter>,
    id: u64,
) -> Result<Response, String> {
    let bytes = presenter
        .pending
        .lock()
        .map_err(|_| "internal error")?
        .get(&id)
        .map(|p| p.original.as_ref().clone())
        .ok_or("This request is no longer waiting.")?;
    Ok(Response::new(bytes))
}

/// The finished picture (the body: raw RGBA, with its `width` and `height` as headers), or the reason it
/// failed (the `error` header).
#[tauri::command]
pub async fn present_result(
    presenter: tauri::State<'_, Presenter>,
    request: Request<'_>,
) -> Result<(), String> {
    let id: u64 = request
        .headers()
        .get("id")
        .and_then(|v| v.to_str().ok())
        .and_then(|v| v.parse().ok())
        .ok_or("The request is unknown.")?;
    let number = |name: &str| -> Option<u32> {
        request
            .headers()
            .get(name)
            .and_then(|v| v.to_str().ok())
            .and_then(|v| v.parse().ok())
    };
    let outcome = match request.headers().get("error").and_then(|v| v.to_str().ok()) {
        Some(reason) => Err(reason.to_owned()),
        None => match (request.body(), number("width"), number("height")) {
            (InvokeBody::Raw(bytes), Some(width), Some(height))
                if width > 0
                    && height > 0
                    && bytes.len() as u64 == u64::from(width) * u64::from(height) * 4 =>
            {
                Ok(Frame {
                    width,
                    height,
                    rgba: bytes.clone(),
                })
            }
            _ => Err("The page sent a malformed picture.".to_owned()),
        },
    };
    let pending = presenter.pending.lock().map_err(|_| "internal error")?;
    if let Some(p) = pending.get(&id) {
        let _ = p.reply.send(outcome);
    }
    Ok(())
}

// ---- originals -----------------------------------------------------------------------------------

pub fn originals_dir(app: &AppHandle) -> Result<PathBuf, String> {
    settings::config_dir(app)
        .map(|d| d.join("originals"))
        .map_err(|e| e.to_string())
}

/// Keeps the capture as it was before the look, under the same file name as the finished picture.
pub fn save_original(
    app: &AppHandle,
    png: &[u8],
    file_name: &std::ffi::OsStr,
) -> Result<PathBuf, String> {
    let dir = originals_dir(app)?;
    fs::create_dir_all(&dir).map_err(|e| format!("{}: {e}", dir.display()))?;
    let path = dir.join(file_name);
    crate::fsutil::write_atomic(&path, png).map_err(|e| format!("{}: {e}", path.display()))?;
    Ok(path)
}

/// Whether `path` is one of the kept originals (the editor then puts the look on as a presentation).
pub fn is_original(app: &AppHandle, path: &Path) -> bool {
    originals_dir(app)
        .ok()
        .is_some_and(|dir| path.parent() == Some(dir.as_path()))
}

/// Removes the originals that are older than `keep`. Returns how many went.
fn cleanup_originals(dir: &Path, now: SystemTime, keep: Duration) -> usize {
    let Ok(entries) = fs::read_dir(dir) else {
        return 0;
    };
    let mut removed = 0;
    for entry in entries.flatten() {
        let old = entry
            .metadata()
            .and_then(|m| m.modified())
            .ok()
            .and_then(|t| now.duration_since(t).ok())
            .is_some_and(|age| age > keep);
        if old
            && entry.path().extension().is_some_and(|e| e == "png")
            && fs::remove_file(entry.path()).is_ok()
        {
            removed += 1;
        }
    }
    removed
}

fn cleanup_originals_in_background(app: &AppHandle) {
    let Ok(dir) = originals_dir(app) else {
        return;
    };
    std::thread::spawn(move || {
        cleanup_originals(&dir, SystemTime::now(), KEEP_ORIGINALS);
    });
}

#[cfg(test)]
mod tests {
    use super::*;

    fn temp_dir(name: &str) -> PathBuf {
        let dir =
            std::env::temp_dir().join(format!("lumengrab-present-{name}-{}", std::process::id()));
        let _ = fs::remove_dir_all(&dir);
        fs::create_dir_all(&dir).unwrap();
        dir
    }

    #[test]
    fn removes_only_old_png_originals() {
        let dir = temp_dir("cleanup");
        let old = dir.join("old.png");
        let fresh = dir.join("fresh.png");
        let other = dir.join("notes.txt");
        for p in [&old, &fresh, &other] {
            fs::write(p, b"x").unwrap();
        }
        let now = SystemTime::now();
        let long_ago = now - Duration::from_secs(40 * 24 * 60 * 60);
        fs::File::options()
            .write(true)
            .open(&old)
            .unwrap()
            .set_modified(long_ago)
            .unwrap();
        fs::File::options()
            .write(true)
            .open(&other)
            .unwrap()
            .set_modified(long_ago)
            .unwrap();
        assert_eq!(cleanup_originals(&dir, now, KEEP_ORIGINALS), 1);
        assert!(!old.exists());
        assert!(fresh.exists());
        assert!(other.exists(), "files that are not pictures are left alone");
        assert_eq!(
            cleanup_originals(&dir.join("missing"), now, KEEP_ORIGINALS),
            0
        );
        let _ = fs::remove_dir_all(&dir);
    }
}
