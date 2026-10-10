//! macOS glue: Screen Recording permission, cursor position, window z-order, overlay window level.

use std::ffi::c_void;
use std::process::Command;

use objc2_app_kit::{NSWindow, NSWindowCollectionBehavior};
use objc2_core_foundation::{CFDictionary, CFNumber, CFNumberType, CFString};
use objc2_core_graphics::{
    CGEvent, CGPreflightScreenCaptureAccess, CGRequestScreenCaptureAccess,
    CGWindowListCopyWindowInfo, CGWindowListOption,
};
use tauri::{ActivationPolicy, AppHandle, WebviewWindow};

/// Above the menu bar and over fullscreen apps (NSScreenSaverWindowLevel).
const OVERLAY_WINDOW_LEVEL: isize = 1000;

/// Menu bar app: no Dock icon, no app menu.
pub fn setup_app(app: &mut tauri::App) {
    app.set_activation_policy(ActivationPolicy::Accessory);
}

/// True if this process may record the screen. Does not prompt.
pub fn has_screen_access() -> bool {
    CGPreflightScreenCaptureAccess()
}

/// Shows the system prompt the first time; afterwards it just returns the current state.
pub fn request_screen_access() -> bool {
    CGRequestScreenCaptureAccess()
}

pub fn open_screen_recording_settings() {
    let _ = Command::new("open")
        .arg("x-apple.systempreferences:com.apple.preference.security?Privacy_ScreenCapture")
        .spawn();
}

/// Opens a web address in the default browser.
pub fn open_url(url: &str) {
    let _ = Command::new("open").arg(url).spawn();
}

/// Selects a file in Finder.
pub fn reveal_file(path: &std::path::Path) {
    let _ = Command::new("open").arg("-R").arg(path).spawn();
}

/// Shows a folder in Finder.
pub fn open_folder(path: &std::path::Path) {
    let _ = Command::new("open").arg(path).spawn();
}

/// Cursor in native units (points, global desktop, y down), same space as `CGDisplayBounds`.
pub fn cursor_position(_app: &AppHandle) -> Option<(f64, f64)> {
    let event = CGEvent::new(None)?;
    let p = CGEvent::location(Some(&event));
    Some((p.x, p.y))
}

/// Window ids of on-screen, non-desktop windows, **front to back** (ScreenCaptureKit's own window
/// list is not in z-order).
pub fn window_ids_front_to_back() -> Vec<u32> {
    let options =
        CGWindowListOption::OptionOnScreenOnly | CGWindowListOption::ExcludeDesktopElements;
    let Some(list) = CGWindowListCopyWindowInfo(options, 0) else {
        return Vec::new();
    };
    let key = CFString::from_str("kCGWindowNumber");
    let mut ids = Vec::new();
    for i in 0..list.count() {
        // SAFETY: CGWindowListCopyWindowInfo returns an array of CFDictionary; the pointers are valid
        // while `list` is alive, and we only read from them.
        unsafe {
            let dict = list.value_at_index(i) as *const CFDictionary;
            if dict.is_null() {
                continue;
            }
            let number =
                (*dict).value(&*key as *const CFString as *const c_void) as *const CFNumber;
            if number.is_null() {
                continue;
            }
            let mut id: i32 = 0;
            if (*number).value(CFNumberType::IntType, &mut id as *mut i32 as *mut c_void) {
                ids.push(id as u32);
            }
        }
    }
    ids
}

/// Makes a capture overlay cover the menu bar and sit over fullscreen apps and every Space.
pub fn configure_overlay(window: &WebviewWindow) {
    let Ok(ptr) = window.ns_window() else {
        return;
    };
    let ptr = ptr as usize;
    let _ = window.run_on_main_thread(move || {
        // SAFETY: `ptr` is the window's NSWindow, alive as long as the window; NSWindow setters must
        // run on the main thread, which `run_on_main_thread` guarantees.
        let ns_window = unsafe { &*(ptr as *const NSWindow) };
        ns_window.setLevel(OVERLAY_WINDOW_LEVEL);
        ns_window.setCollectionBehavior(
            NSWindowCollectionBehavior::CanJoinAllSpaces
                | NSWindowCollectionBehavior::FullScreenAuxiliary
                | NSWindowCollectionBehavior::Stationary
                | NSWindowCollectionBehavior::IgnoresCycle,
        );
        ns_window.setHasShadow(false);
        ns_window.setAcceptsMouseMovedEvents(true);
    });
}

/// Overlay position/size in logical points (macOS native units are points).
pub fn position_overlay<'a>(
    builder: tauri::WebviewWindowBuilder<'a, tauri::Wry, AppHandle>,
    native: &crate::capture::NativeRect,
) -> tauri::WebviewWindowBuilder<'a, tauri::Wry, AppHandle> {
    builder
        .position(native.x, native.y)
        .inner_size(native.width, native.height)
}

/// Placement already happened in the builder.
pub fn finish_overlay_placement(_window: &WebviewWindow, _native: &crate::capture::NativeRect) {}
