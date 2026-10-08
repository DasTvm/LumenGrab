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

/// Windows native units are physical pixels, which the builder cannot express (it only takes logical
/// units), so the window is created anywhere and placed physically after it exists.
pub fn position_overlay<'a>(
    builder: tauri::WebviewWindowBuilder<'a, tauri::Wry, AppHandle>,
    _native: &crate::capture::NativeRect,
) -> tauri::WebviewWindowBuilder<'a, tauri::Wry, AppHandle> {
    builder
}

/// Places the overlay exactly over its display in physical pixels. Position, size, then position
/// again: moving a window onto a monitor with another DPI can make Windows rescale it (WM_DPICHANGED),
/// and the second pass undoes that. To be verified on mixed-DPI hardware (CAPTURE_TEST_CHECKLIST).
pub fn finish_overlay_placement(window: &WebviewWindow, native: &crate::capture::NativeRect) {
    use tauri::{PhysicalPosition, PhysicalSize};
    let pos = PhysicalPosition::new(native.x as i32, native.y as i32);
    let size = PhysicalSize::new(native.width as u32, native.height as u32);
    for _ in 0..2 {
        let _ = window.set_position(pos);
        let _ = window.set_size(size);
    }
    let _ = window.set_position(pos);
}

/// Windows has no screen recording permission; kept so shared code compiles on both OSes.
pub fn open_screen_recording_settings() {}
