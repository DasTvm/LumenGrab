//! Global hotkeys. Fixed for now (configurable later): Ctrl+Shift+3 fullscreen, 4 area, 5 window,
//! on both macOS and Windows. Registered in Rust at startup so they work with no window open.

use tauri::AppHandle;
use tauri_plugin_global_shortcut::{Code, GlobalShortcutExt, Modifiers, Shortcut, ShortcutState};

use crate::capture::{flow, output, CaptureMode};

const MODIFIERS: Modifiers = Modifiers::CONTROL.union(Modifiers::SHIFT);

const HOTKEYS: [(Code, &str, CaptureMode); 3] = [
    (Code::Digit3, "Ctrl+Shift+3", CaptureMode::Fullscreen),
    (Code::Digit4, "Ctrl+Shift+4", CaptureMode::Area),
    (Code::Digit5, "Ctrl+Shift+5", CaptureMode::Window),
];

fn escape() -> Shortcut {
    Shortcut::new(None, Code::Escape)
}

/// While a capture is in progress Esc cancels it even if the overlay window did not get keyboard
/// focus (an accessory app on macOS is not always allowed to take focus). Released again when the
/// capture ends, so Esc is only ever taken from other apps for the few seconds an overlay is up.
pub fn grab_escape(app: &AppHandle) {
    let _ = app.global_shortcut().register(escape());
}

pub fn release_escape(app: &AppHandle) {
    let _ = app.global_shortcut().unregister(escape());
}

pub fn plugin() -> tauri::plugin::TauriPlugin<tauri::Wry> {
    tauri_plugin_global_shortcut::Builder::new()
        .with_handler(|app, shortcut, event| {
            if event.state() != ShortcutState::Pressed {
                return;
            }
            if *shortcut == escape() {
                flow::cancel_active(app);
                return;
            }
            if let Some((_, _, mode)) = HOTKEYS
                .iter()
                .find(|(code, _, _)| *shortcut == Shortcut::new(Some(MODIFIERS), *code))
            {
                flow::start(app, *mode);
            }
        })
        .build()
}

/// Registers the hotkeys. A key another app already owns is reported once; the tray menu still works.
pub fn register(app: &AppHandle) {
    let failed: Vec<&str> = HOTKEYS
        .iter()
        .filter(|(code, _, _)| {
            app.global_shortcut()
                .register(Shortcut::new(Some(MODIFIERS), *code))
                .is_err()
        })
        .map(|(_, name, _)| *name)
        .collect();
    if !failed.is_empty() {
        output::error_dialog(
            app,
            &format!(
                "These shortcuts are already used by another app and do not work in LumenGrab: {}.\n\nYou can still capture from the LumenGrab menu bar icon.",
                failed.join(", ")
            ),
        );
    }
}
