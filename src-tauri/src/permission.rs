//! The "Allow screen recording" window (design: Onboarding Permission) and its commands.
//! Only macOS ever needs it: elsewhere the capturer always reports the permission as granted.

use std::sync::Arc;

use tauri::{AppHandle, Manager, State, WebviewUrl, WebviewWindowBuilder};

use crate::{capture::Capturer, platform};

pub const LABEL: &str = "permission";
const LOST_LABEL: &str = "permission-lost";

/// Set once this run has seen the permission granted. If a capture is refused after that, the user
/// turned it off while LumenGrab was running (a different message than the first-run explanation).
static HAD_PERMISSION: std::sync::atomic::AtomicBool = std::sync::atomic::AtomicBool::new(false);

pub fn remember_granted() {
    HAD_PERMISSION.store(true, std::sync::atomic::Ordering::Relaxed);
}

/// A capture was refused: the first-run explanation, or "turned off while running".
pub fn help(app: &AppHandle) {
    if HAD_PERMISSION.load(std::sync::atomic::Ordering::Relaxed) {
        show_lost(app);
    } else {
        show(app);
    }
}

/// The blocking dialog "Screen Recording is turned off" (design: Feedback and Errors, 04).
pub fn show_lost(app: &AppHandle) {
    if let Some(window) = app.get_webview_window(LOST_LABEL) {
        let _ = window.show();
        let _ = window.set_focus();
        return;
    }
    let result = WebviewWindowBuilder::new(
        app,
        LOST_LABEL,
        WebviewUrl::App("index.html?window=dialog&kind=permission-lost".into()),
    )
    .title("LumenGrab")
    .inner_size(560.0, 330.0)
    .resizable(false)
    .minimizable(false)
    .always_on_top(true)
    .center()
    .build();
    match result {
        Ok(window) => {
            let _ = window.set_focus();
        }
        Err(e) => eprintln!("failed to open the permission dialog: {e}"),
    }
}

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

#[tauri::command]
pub fn quit_app(app: AppHandle) {
    app.exit(0);
}

/// macOS applies a newly granted permission only to processes started afterwards.
#[tauri::command]
pub fn restart_app(app: AppHandle) {
    app.restart();
}
