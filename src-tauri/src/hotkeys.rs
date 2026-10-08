//! Global hotkeys. Fixed for now (configurable later): Ctrl+Shift+3 fullscreen, 4 area, 5 window,
//! on both macOS and Windows. Registered in Rust at startup so they work with no window open.

use std::sync::mpsc::{channel, Sender};

use tauri::{AppHandle, Manager};
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

/// Esc is grabbed globally only while a capture is in progress, so it cancels even if the overlay did
/// not get keyboard focus. Registering and unregistering is done by ONE worker thread, in order:
///
/// **Never call `register`/`unregister` from a shortcut handler, a command or an event callback.**
/// The plugin runs handlers while holding its internal shortcut lock, and `unregister` takes the same
/// lock, so calling it from a handler deadlocks the main thread (this froze the overlays, and with
/// them the whole screen, in the first test build). The worker also keeps grab/release in order.
pub struct EscapeGrab(Sender<bool>);

pub fn start_escape_worker(app: &AppHandle) {
    let (tx, rx) = channel::<bool>();
    let handle = app.clone();
    std::thread::spawn(move || {
        let mut grabbed = false;
        for want in rx {
            if want == grabbed {
                continue;
            }
            let shortcuts = handle.global_shortcut();
            let result = if want {
                shortcuts.register(escape())
            } else {
                shortcuts.unregister(escape())
            };
            if result.is_ok() {
                grabbed = want;
            }
        }
    });
    app.manage(EscapeGrab(tx));
}

pub fn grab_escape(app: &AppHandle) {
    let _ = app.state::<EscapeGrab>().0.send(true);
}

pub fn release_escape(app: &AppHandle) {
    let _ = app.state::<EscapeGrab>().0.send(false);
}

pub fn plugin() -> tauri::plugin::TauriPlugin<tauri::Wry> {
    tauri_plugin_global_shortcut::Builder::new()
        .with_handler(|app, shortcut, event| {
            if event.state() != ShortcutState::Pressed {
                return;
            }
            if *shortcut == escape() {
                // Hand off to another thread: this handler runs with the plugin's lock held.
                let app = app.clone();
                std::thread::spawn(move || flow::cancel_active(&app));
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
