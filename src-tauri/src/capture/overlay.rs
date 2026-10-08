//! Overlay windows: one borderless, always-on-top window per display that shows that display's
//! frozen frame. The UI is TypeScript (`?window=overlay`); this only creates, shows and closes them.

use tauri::{AppHandle, Manager, WebviewUrl, WebviewWindow, WebviewWindowBuilder};

use super::{CaptureMode, DisplayInfo};
use crate::platform;

pub fn label(session: &str, display: u32) -> String {
    format!("overlay-{session}-{display}")
}

fn prefix(session: &str) -> String {
    format!("overlay-{session}-")
}

/// Session id from an overlay window label, if it is one.
pub fn session_of_label(label: &str) -> Option<&str> {
    label
        .strip_prefix("overlay-")?
        .rsplit_once('-')
        .map(|(session, _)| session)
}

fn mode_name(mode: CaptureMode) -> &'static str {
    match mode {
        CaptureMode::Area => "area",
        CaptureMode::Window => "window",
        CaptureMode::Fullscreen => "fullscreen",
    }
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

/// Creates the overlays hidden. Each one shows itself through `show` once its frame is painted,
/// so there is no white flash and no half-loaded overlay. Called while the displays are still being
/// captured (hidden windows are never part of a capture), which hides the window creation time.
pub fn open_all(
    app: &AppHandle,
    session_id: &str,
    mode: CaptureMode,
    displays: &[DisplayInfo],
) -> tauri::Result<()> {
    for d in displays {
        let url = format!(
            "index.html?window=overlay&session={session_id}&display={}&mode={}",
            d.id,
            mode_name(mode)
        );
        let builder =
            WebviewWindowBuilder::new(app, label(session_id, d.id), WebviewUrl::App(url.into()))
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

/// Shows one overlay; the one on the display under the cursor also takes keyboard focus (Esc).
pub fn show(app: &AppHandle, session: &str, display: &DisplayInfo, focus: bool) {
    if let Some(window) = app.get_webview_window(&label(session, display.id)) {
        let _ = window.show();
        if focus {
            let _ = window.set_focus();
        }
    }
}

/// Makes the overlay of `display` the key window, so it receives hover and keyboard events.
pub fn focus(app: &AppHandle, session: &str, display: u32) {
    if let Some(window) = app.get_webview_window(&label(session, display)) {
        let _ = window.set_focus();
    }
}

pub fn close_all(app: &AppHandle, session: &str) {
    let prefix = prefix(session);
    let windows: Vec<WebviewWindow> = app
        .webview_windows()
        .into_iter()
        .filter(|(label, _)| label.starts_with(&prefix))
        .map(|(_, w)| w)
        .collect();
    for window in windows {
        let _ = window.destroy();
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn labels_roundtrip() {
        let l = label("s12", 3);
        assert_eq!(l, "overlay-s12-3");
        assert_eq!(session_of_label(&l), Some("s12"));
        assert_eq!(session_of_label("settings"), None);
        assert_eq!(session_of_label("overlay-s1-2"), Some("s1"));
    }
}
