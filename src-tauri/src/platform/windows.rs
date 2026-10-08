//! Windows glue. Native units are physical pixels, and tao makes the process per-monitor DPI aware
//! when the event loop starts, so every position/size here is in physical pixels.

use tauri::{AppHandle, WebviewWindow};

pub fn setup_app(_app: &mut tauri::App) {}

/// Cursor in native units (physical pixels, virtual desktop, y down).
pub fn cursor_position(app: &AppHandle) -> Option<(f64, f64)> {
    app.cursor_position().ok().map(|p| (p.x, p.y))
}

/// Always-on-top is set by the window builder; nothing else is needed on Windows.
pub fn configure_overlay(_window: &WebviewWindow) {}
