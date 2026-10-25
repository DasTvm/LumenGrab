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
/// `NSFloatingWindowLevel`: above normal windows, below the capture overlay and the Quick Access cards.
const PIN_WINDOW_LEVEL: isize = 3;

/// Menu bar app: no Dock icon, no app menu.
pub fn setup_app(app: &mut tauri::App) {
    app.set_activation_policy(ActivationPolicy::Accessory);
}

/// Windows the user works in: they make the app a normal one (Dock icon, Cmd+Tab) while any is open.
/// Overlays, Quick Access cards and the permission dialogs do not: they come and go without the Dock jumping.
fn is_workspace_window(label: &str) -> bool {
    label == "settings" || label == "history" || label == "recover" || label.starts_with("doc-")
}

/// A menu bar app has no Dock icon and cannot be reached with Cmd+Tab, which is wrong while an editor or
/// settings window is open: it should be a normal window of a normal app. Call after a window was opened
/// and when one is closing (`closing` names it, it may still be listed).
pub fn update_dock_presence(app: &AppHandle, closing: Option<&str>) {
    use tauri::Manager;
    let any = app
        .webview_windows()
        .keys()
        .any(|label| Some(label.as_str()) != closing && is_workspace_window(label));
    let policy = if any {
        ActivationPolicy::Regular
    } else {
        ActivationPolicy::Accessory
    };
    let _ = app.set_activation_policy(policy);
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

/// What a support request needs to know about this copy of the app: where it runs from, whether macOS
/// moved it (App Translocation), its quarantine flag and its code signature. Plain text, no personal data
/// beyond the install path (the user's folder name shows up there, and is theirs to share or not).
pub fn diagnostics() -> String {
    let run = |program: &str, args: &[&str]| -> String {
        Command::new(program)
            .args(args)
            .output()
            .map(|o| {
                let mut text = String::from_utf8_lossy(&o.stdout).into_owned();
                text.push_str(&String::from_utf8_lossy(&o.stderr));
                text.trim().chars().take(900).collect::<String>()
            })
            .unwrap_or_else(|e| e.to_string())
    };
    let exe = std::env::current_exe().ok();
    // `Contents/MacOS/lumengrab` is three steps below the `.app` folder.
    let app = exe
        .as_ref()
        .and_then(|e| e.ancestors().nth(3))
        .map(|p| p.to_string_lossy().into_owned())
        .unwrap_or_default();
    let signature: Vec<String> = run("codesign", &["-dv", "--verbose=2", &app])
        .lines()
        .filter(|l| {
            [
                "Identifier=",
                "Signature=",
                "flags=",
                "Info.plist",
                "Sealed",
                "Authority=",
                "not signed",
            ]
            .iter()
            .any(|k| l.contains(k))
        })
        .map(str::to_string)
        .collect();
    let verify = run("codesign", &["--verify", "--deep", "--strict", &app]);
    let quarantine = run("xattr", &["-p", "com.apple.quarantine", &app]);
    format!(
        "macOS: {}\nMachine: {}\nApp: {app}\nTranslocated: {}\nQuarantine: {}\nSignature:\n{}\nVerify: {}",
        run("sw_vers", &["-productVersion"]),
        run("uname", &["-m"]),
        app.contains("/AppTranslocation/"),
        if quarantine.is_empty() || quarantine.contains("No such xattr") {
            "none".to_string()
        } else {
            quarantine
        },
        signature.join("\n"),
        if verify.is_empty() { "ok".to_string() } else { verify },
    )
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

/// A pinned capture floats above other windows and fullscreen apps, on every Space, with the system shadow.
pub fn configure_pin(window: &WebviewWindow) {
    let Ok(ptr) = window.ns_window() else {
        return;
    };
    let ptr = ptr as usize;
    let _ = window.run_on_main_thread(move || {
        // SAFETY: as in `configure_overlay`.
        let ns_window = unsafe { &*(ptr as *const NSWindow) };
        ns_window.setLevel(PIN_WINDOW_LEVEL);
        ns_window.setCollectionBehavior(
            NSWindowCollectionBehavior::CanJoinAllSpaces
                | NSWindowCollectionBehavior::FullScreenAuxiliary
                | NSWindowCollectionBehavior::IgnoresCycle,
        );
        ns_window.setHasShadow(true);
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
