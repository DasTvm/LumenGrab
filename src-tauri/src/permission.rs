//! The "Allow screen recording" window (design: Onboarding Permission) and its commands.
//! Only macOS ever needs it: elsewhere the capturer always reports the permission as granted.

use std::sync::Arc;

use tauri::{AppHandle, Manager, State, WebviewUrl, WebviewWindowBuilder};

use crate::{capture::Capturer, platform};

pub const LABEL: &str = "permission";

/// Opens the permission window, or focuses it if it is already open.
pub fn show(app: &AppHandle) {
    if let Some(window) = app.get_webview_window(LABEL) {
        let _ = window.show();
        let _ = window.set_focus();
        return;
    }
    let result = WebviewWindowBuilder::new(
        app,
        LABEL,
        WebviewUrl::App("index.html?window=permission".into()),
    )
    .title("LumenGrab")
    .inner_size(900.0, 600.0)
    .resizable(false)
    .center()
    .build();
    match result {
        Ok(window) => {
            let _ = window.set_focus();
        }
        Err(e) => eprintln!("failed to open the permission window: {e}"),
    }
}

#[tauri::command]
pub fn permission_status(capturer: State<Arc<dyn Capturer>>) -> bool {
    capturer.permission_granted()
}

/// "Open System Settings": asks the OS once (which also adds LumenGrab to the list in System
/// Settings; macOS only lists apps that have asked), then opens the Screen Recording pane.
#[tauri::command]
pub fn permission_open_settings(capturer: State<Arc<dyn Capturer>>) {
    capturer.request_permission();
    platform::open_screen_recording_settings();
}

#[tauri::command]
pub fn permission_close(app: AppHandle) {
    if let Some(window) = app.get_webview_window(LABEL) {
        let _ = window.destroy();
    }
}

/// macOS applies a newly granted permission only to processes started afterwards.
#[tauri::command]
pub fn restart_app(app: AppHandle) {
    app.restart();
}
