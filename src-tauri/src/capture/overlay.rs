//! Overlay windows: one borderless, always-on-top window per display that shows that display's
//! frozen frame. The UI is TypeScript (`?window=overlay`); this only creates, shows and closes them.

use tauri::{AppHandle, Manager, WebviewUrl, WebviewWindow, WebviewWindowBuilder};

use super::{store::Session, CaptureMode, DisplayInfo};
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

/// Creates the overlays hidden. Each one shows itself through `show` once its frame is painted,
/// so there is no white flash and no half-loaded overlay.
pub fn open_all(app: &AppHandle, session: &Session) -> tauri::Result<()> {
    for d in &session.displays {
        let url = format!(
            "index.html?window=overlay&session={}&display={}&mode={}",
            session.id,
            d.info.id,
            mode_name(session.mode)
        );
        let builder = WebviewWindowBuilder::new(
            app,
            label(&session.id, d.info.id),
            WebviewUrl::App(url.into()),
        )
        .title("LumenGrab Capture")
        .decorations(false)
        .resizable(false)
        .shadow(false)
        .always_on_top(true)
        .skip_taskbar(true)
        .visible(false)
        // Defence in depth: ask the OS to keep the overlay out of captures.
        .content_protected(true);
        let window = platform::position_overlay(builder, &d.info.native).build()?;
        platform::configure_overlay(&window);
        platform::finish_overlay_placement(&window, &d.info.native);
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
