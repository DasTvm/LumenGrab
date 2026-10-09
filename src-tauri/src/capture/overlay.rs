//! Overlay windows: one borderless, always-on-top window per display that shows that display's
//! frozen frame. The UI is TypeScript (`?window=overlay`); this only creates, shows and hides them.
//!
//! The windows are **kept warm**: they are created once (hidden, at startup) and reused for every
//! capture. Creating a window with a web view costs 300-500 ms, which would be most of the time
//! between the hotkey and the overlay. A capture only *assigns* its session to the waiting windows
//! (event `capture-overlay`), and releasing it hides them again. If the display layout changed since
//! they were created, they are rebuilt (once) at the next capture.
//!
//! Locking rule: `Pool::state` is only held for a moment and never while waiting for the main
//! thread (sync Tauri commands run on the main thread and take it too). Window creation is
//! serialised by `Pool::creating`, which only worker threads take.

use std::sync::{
    atomic::{AtomicBool, Ordering},
    Mutex,
};

use serde::Serialize;
use tauri::{AppHandle, Emitter, Manager, WebviewUrl, WebviewWindow, WebviewWindowBuilder};

use super::{flow, CaptureMode, DisplayInfo};
use crate::platform;

/// No `-` after the prefix, so `session_of_label`-style parsing can never mistake a pool window for
/// a session window.
const POOL_PREFIX: &str = "overlay-warm";

pub fn pool_label(display: u32) -> String {
    format!("{POOL_PREFIX}{display}")
}

#[derive(Default)]
struct State {
    /// The display layout the windows were built for; `None` until they exist.
    layout: Option<Vec<DisplayInfo>>,
    /// The capture the windows currently belong to.
    assigned: Option<String>,
}

#[derive(Default)]
pub struct Pool {
    state: Mutex<State>,
    creating: Mutex<()>,
    /// Set while `ensure` tears old windows down on purpose, so that is not mistaken for the user
    /// or the OS closing an overlay in the middle of a capture.
    rebuilding: AtomicBool,
}

/// What the overlay windows are told: which capture to show, or `None` to go back to waiting.
#[derive(Clone, Serialize)]
struct Assignment<'a> {
    display: u32,
    session: Option<&'a str>,
}

/// Overlays are deliberately **not** content protected. Measured on macOS 27: with a protected
/// window on screen, ScreenCaptureKit returns a completely black frame for the whole display (the
/// system screenshot tool just leaves the window out). We never capture while an overlay is up (the
/// displays are frozen first), but a black frame in a race would silently ruin a screenshot.
/// Dev builds can switch it on with `LUMENGRAB_DEV_PROTECTED=1` to re-test (see `dev.rs`).
fn content_protected() -> bool {
    #[cfg(any(debug_assertions, feature = "dev-hooks"))]
    if std::env::var("LUMENGRAB_DEV_PROTECTED").is_ok() {
        return true;
    }
    false
}

fn pool_windows(app: &AppHandle) -> Vec<WebviewWindow> {
    app.webview_windows()
        .into_iter()
        .filter(|(label, _)| label.starts_with(POOL_PREFIX))
        .map(|(_, w)| w)
        .collect()
}

/// Makes sure there is one hidden overlay window per display, built for exactly this layout. Does
/// nothing (and returns at once) if they already exist. Call from a worker thread, never from the
/// main thread or a command: creating windows waits for the main thread.
pub fn ensure(app: &AppHandle, displays: &[DisplayInfo]) -> tauri::Result<()> {
    let pool = app.state::<Pool>();
    let _creating = pool.creating.lock().expect("pool creation lock");

    let up_to_date = pool.state.lock().expect("pool state").layout.as_deref() == Some(displays)
        && displays
            .iter()
            .all(|d| app.get_webview_window(&pool_label(d.id)).is_some());
    if up_to_date {
        return Ok(());
    }

    // Build: first remove what is there (stale layout), then create one hidden window per display.
    pool.rebuilding.store(true, Ordering::SeqCst);
    pool.state.lock().expect("pool state").layout = None;
    for window in pool_windows(app) {
        let _ = window.destroy();
    }
    let built = open_all(app, displays);
    pool.rebuilding.store(false, Ordering::SeqCst);
    built?;
    pool.state.lock().expect("pool state").layout = Some(displays.to_vec());
    Ok(())
}

/// Creates the overlays hidden. Each one shows itself through `show` once its frame is painted, so
/// there is no white flash and no half-loaded overlay. Hidden windows are never part of a capture.
fn open_all(app: &AppHandle, displays: &[DisplayInfo]) -> tauri::Result<()> {
    for d in displays {
        let url = format!("index.html?window=overlay&display={}", d.id);
        let builder = WebviewWindowBuilder::new(app, pool_label(d.id), WebviewUrl::App(url.into()))
            .title("LumenGrab Capture")
            .decorations(false)
            .resizable(false)
            .shadow(false)
            .always_on_top(true)
            .skip_taskbar(true)
            .visible(false)
            .content_protected(content_protected());
        let window = platform::position_overlay(builder, &d.native).build()?;
        platform::configure_overlay(&window);
        platform::finish_overlay_placement(&window, &d.native);
    }
    Ok(())
}

/// Builds the overlay windows shortly after startup (if the screen permission is already there),
/// so the first capture is as fast as the later ones. Without the permission nothing happens: the
/// first capture builds them.
pub fn warm_up(app: &AppHandle) {
    let app = app.clone();
    std::thread::spawn(move || {
        std::thread::sleep(std::time::Duration::from_millis(600));
        let capturer = app
            .state::<std::sync::Arc<dyn super::Capturer>>()
            .inner()
            .clone();
        if !capturer.permission_granted() {
            return;
        }
        let Ok(displays) = capturer.displays() else {
            return;
        };
        if let Err(e) = ensure(&app, &displays) {
            eprintln!("[lumengrab] could not prepare the capture overlays: {e}");
        }
    });
}

/// Gives the capture to the overlay windows. They start asking for its frames right away; windows
/// that are still being created ask for the assignment themselves when they load.
pub fn assign(app: &AppHandle, session: &str) {
    let pool = app.state::<Pool>();
    pool.state.lock().expect("pool state").assigned = Some(session.to_owned());
    for window in pool_windows(app) {
        if let Some(display) = display_of(window.label()) {
            let _ = app.emit_to(
                window.label(),
                "capture-overlay",
                Assignment {
                    display,
                    session: Some(session),
                },
            );
        }
    }
}

/// The capture a freshly loaded overlay window should show, if one is running.
pub fn assignment(app: &AppHandle) -> Option<String> {
    app.state::<Pool>()
        .state
        .lock()
        .expect("pool state")
        .assigned
        .clone()
}

/// Ends the capture for the windows: hide them and send them back to waiting. A late request for
/// an old capture (it was already replaced by a new one) does nothing.
pub fn release(app: &AppHandle, session: &str) {
    let pool = app.state::<Pool>();
    {
        let mut state = pool.state.lock().expect("pool state");
        if state.assigned.as_deref() != Some(session) {
            return;
        }
        state.assigned = None;
    }
    for window in pool_windows(app) {
        let _ = window.hide();
        if let Some(display) = display_of(window.label()) {
            let _ = app.emit_to(
                window.label(),
                "capture-overlay",
                Assignment {
                    display,
                    session: None,
                },
            );
        }
    }
}

/// An overlay window was destroyed. If that happens during a capture and not because we rebuild
/// the windows, the capture cannot continue: end it so it never stays stuck "busy".
pub fn on_destroyed(app: &AppHandle, label: &str) {
    if !label.starts_with(POOL_PREFIX) {
        return;
    }
    let pool = app.state::<Pool>();
    if pool.rebuilding.load(Ordering::SeqCst) {
        return;
    }
    pool.state.lock().expect("pool state").layout = None; // rebuilt at the next capture
    if let Some(session) = assignment(app) {
        flow::finish(app, &session);
    }
}

fn display_of(label: &str) -> Option<u32> {
    label.strip_prefix(POOL_PREFIX)?.parse().ok()
}

/// Shows one overlay; the one on the display under the cursor also takes keyboard focus (Esc).
pub fn show(app: &AppHandle, display: &DisplayInfo, focus: bool) {
    if let Some(window) = app.get_webview_window(&pool_label(display.id)) {
        let _ = window.show();
        if focus {
            let _ = window.set_focus();
        }
    }
}

/// Makes the overlay of `display` the key window, so it receives hover and keyboard events.
pub fn focus(app: &AppHandle, display: u32) {
    if let Some(window) = app.get_webview_window(&pool_label(display)) {
        let _ = window.set_focus();
    }
}

#[derive(Clone, Serialize)]
struct ModeChanged<'a> {
    session: &'a str,
    mode: CaptureMode,
}

/// Tells every overlay of the session that the mode changed (event `capture-mode`).
pub fn broadcast_mode(app: &AppHandle, session: &str, mode: CaptureMode) {
    for window in pool_windows(app) {
        let _ = window.emit("capture-mode", ModeChanged { session, mode });
    }
}

/// The capture is ready: overlays that are waiting for its frames can fetch them now.
pub fn announce_published(app: &AppHandle, session: &str) {
    let _ = app.emit("capture-published", session);
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn pool_labels_roundtrip_and_are_not_session_labels() {
        assert_eq!(pool_label(3), "overlay-warm3");
        assert_eq!(display_of("overlay-warm3"), Some(3));
        assert_eq!(display_of("settings"), None);
        assert_eq!(display_of("overlay-warm"), None);
    }
}
