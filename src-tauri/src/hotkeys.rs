//! Global hotkeys. Fixed for now (configurable later), the same on macOS and Windows:
//! Ctrl+Shift+1 is the main one (capture bar, starts in the default mode from the settings), and
//! 3 fullscreen, 4 area, 5 window are quick picks that start straight in that mode without the bar.
//! Registered in Rust at startup so they work with no window open.

use std::sync::mpsc::{channel, Sender};

use serde::Serialize;
use tauri::{AppHandle, Manager};
use tauri_plugin_global_shortcut::{Code, GlobalShortcutExt, Modifiers, Shortcut, ShortcutState};

use crate::capture::{flow, output, CaptureMode};

const MODIFIERS: Modifiers = Modifiers::CONTROL.union(Modifiers::SHIFT);

#[derive(Clone, Copy, PartialEq, Eq, Debug)]
enum Action {
    /// The capture bar, in the user's default mode.
    Bar,
    /// Straight into one mode, no bar.
    Quick(CaptureMode),
}

/// Fixed for now. `(key, display text, action)`; the display text is also what the settings page shows.
const HOTKEYS: [(Code, &str, Action); 4] = [
    (Code::Digit1, "Ctrl+Shift+1", Action::Bar),
    (
        Code::Digit3,
        "Ctrl+Shift+3",
        Action::Quick(CaptureMode::Fullscreen),
    ),
    (
        Code::Digit4,
        "Ctrl+Shift+4",
        Action::Quick(CaptureMode::Area),
    ),
    (
        Code::Digit5,
        "Ctrl+Shift+5",
        Action::Quick(CaptureMode::Window),
    ),
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
            if let Some((_, _, action)) = HOTKEYS
                .iter()
                .find(|(code, _, _)| *shortcut == Shortcut::new(Some(MODIFIERS), *code))
            {
                match action {
                    Action::Bar => flow::start_with_bar(app),
                    Action::Quick(mode) => flow::start(app, *mode, false),
                }
            }
        })
        .build()
}

/// What the settings page shows for one hotkey.
#[derive(Serialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct HotkeyInfo {
    /// `capture` (the main shortcut with the capture bar), `area`, `window` or `fullscreen`.
    pub id: &'static str,
    /// Key names, e.g. `["Ctrl", "Shift", "4"]`. The frontend renders them per OS.
    pub keys: Vec<&'static str>,
    /// False if another app already owns the shortcut.
    pub registered: bool,
}

/// Shortcuts that could not be registered (taken by another app), kept for the settings page.
pub struct HotkeyFailures(pub Vec<&'static str>);

fn action_id(action: Action) -> &'static str {
    match action {
        Action::Bar => "capture",
        Action::Quick(CaptureMode::Area) => "area",
        Action::Quick(CaptureMode::Window) => "window",
        Action::Quick(CaptureMode::Fullscreen) => "fullscreen",
    }
}

/// Capture, area, window, fullscreen: the order the settings page lists them in.
pub fn list(failed: &[&'static str]) -> Vec<HotkeyInfo> {
    [
        Action::Bar,
        Action::Quick(CaptureMode::Area),
        Action::Quick(CaptureMode::Window),
        Action::Quick(CaptureMode::Fullscreen),
    ]
    .into_iter()
    .filter_map(|action| HOTKEYS.iter().find(|(_, _, a)| *a == action))
    .map(|(_, name, action)| HotkeyInfo {
        id: action_id(*action),
        keys: name.split('+').collect(),
        registered: !failed.contains(name),
    })
    .collect()
}

/// Registers the hotkeys. A key another app already owns is reported once; the tray menu still works.
/// Returns the names of the shortcuts that failed.
pub fn register(app: &AppHandle) -> Vec<&'static str> {
    let failed: Vec<&'static str> = HOTKEYS
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
    failed
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn list_matches_the_agreed_shortcuts_in_page_order() {
        let l = list(&[]);
        let rows: Vec<(&str, Vec<&str>)> = l.iter().map(|h| (h.id, h.keys.clone())).collect();
        assert_eq!(
            rows,
            vec![
                ("capture", vec!["Ctrl", "Shift", "1"]),
                ("area", vec!["Ctrl", "Shift", "4"]),
                ("window", vec!["Ctrl", "Shift", "5"]),
                ("fullscreen", vec!["Ctrl", "Shift", "3"]),
            ]
        );
        assert!(l.iter().all(|h| h.registered));
    }

    #[test]
    fn a_taken_shortcut_is_reported_as_not_registered() {
        let l = list(&["Ctrl+Shift+5"]);
        let window = l.iter().find(|h| h.id == "window").unwrap();
        assert!(!window.registered);
        assert!(l.iter().filter(|h| h.id != "window").all(|h| h.registered));
    }
}
