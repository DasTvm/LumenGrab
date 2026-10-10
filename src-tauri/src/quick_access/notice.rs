//! Notice cards: what used to be native error dialogs (design: "Feedback and Errors"). They use the
//! same windows and the same corner stack as the Quick Access cards, never close by themselves and
//! carry their own buttons. Each button is a [`Handler`]: what it does is decided here, in Rust,
//! the page only says "button number 1 was pressed".

use std::{path::PathBuf, sync::Arc};

use serde::Serialize;

use crate::capture::{CaptureMode, Frame};

#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize)]
#[serde(rename_all = "lowercase")]
pub enum Tone {
    Error,
    Warning,
    /// Not a problem: the first-start hint.
    Info,
}

/// What a notice button does.
#[derive(Clone)]
pub enum Handler {
    Dismiss,
    OpenSettings,
    CopyText(String),
    /// Starts the same capture again.
    CaptureAgain {
        mode: CaptureMode,
        toolbar: bool,
    },
    /// Copies the saved file to the clipboard again.
    CopyAgain(PathBuf),
    /// Opens the "Save as…" dialog for a saved file.
    SaveAs(PathBuf),
    /// Selects the file in Finder / Explorer.
    Reveal(PathBuf),
    /// Saves the capture again to the same folder.
    RetrySave {
        frame: Arc<Frame>,
        source: CaptureMode,
    },
    /// Asks for another folder and saves the capture there.
    ChooseFolder {
        frame: Arc<Frame>,
        source: CaptureMode,
    },
}

#[derive(Clone)]
pub struct Action {
    pub label: &'static str,
    /// A name the page maps to an icon: `refresh`, `folder`, `download`, `settings`, `copy`, `none`.
    pub icon: &'static str,
    pub primary: bool,
    pub handler: Handler,
}

#[derive(Clone)]
pub struct Notice {
    pub tone: Tone,
    /// A name the page maps to an icon: `triangle-alert`, `clipboard-x`, `keyboard`, `scan-line`, `trash`.
    pub icon: &'static str,
    pub title: String,
    pub body: String,
    /// Keys to draw as keycaps under the text (the first-start hint).
    pub keys: Vec<&'static str>,
    pub actions: Vec<Action>,
}

/// What the page needs to draw a notice (camelCase for TypeScript).
#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct NoticePayload {
    pub tone: Tone,
    pub icon: &'static str,
    pub title: String,
    pub body: String,
    pub keys: Vec<&'static str>,
    pub actions: Vec<ActionPayload>,
}

#[derive(Clone, Serialize)]
pub struct ActionPayload {
    pub label: &'static str,
    pub icon: &'static str,
    pub primary: bool,
}

impl Notice {
    pub fn payload(&self) -> NoticePayload {
        NoticePayload {
            tone: self.tone,
            icon: self.icon,
            title: self.title.clone(),
            body: self.body.clone(),
            keys: self.keys.clone(),
            actions: self
                .actions
                .iter()
                .map(|a| ActionPayload {
                    label: a.label,
                    icon: a.icon,
                    primary: a.primary,
                })
                .collect(),
        }
    }
}

fn button(label: &'static str, icon: &'static str, primary: bool, handler: Handler) -> Action {
    Action {
        label,
        icon,
        primary,
        handler,
    }
}

fn dismiss() -> Action {
    button("Dismiss", "none", false, Handler::Dismiss)
}

/// "Could not save the screenshot": the picture is still in memory, so it can be saved again.
pub fn save_failed(folder: &str, error: &str, frame: Arc<Frame>, source: CaptureMode) -> Notice {
    // "/Users/x/Pictures/LumenGrab: Permission denied (os error 13)": the reason is the last part.
    let reason = error.rsplit(": ").next().unwrap_or(error);
    Notice {
        tone: Tone::Error,
        icon: "triangle-alert",
        title: "Could not save the screenshot".into(),
        body: format!(
            "The folder {folder} is not writable ({reason}). Choose another folder or try again."
        ),
        keys: Vec::new(),
        actions: vec![
            button(
                "Retry",
                "refresh",
                true,
                Handler::RetrySave {
                    frame: frame.clone(),
                    source,
                },
            ),
            button(
                "Choose folder…",
                "folder",
                false,
                Handler::ChooseFolder { frame, source },
            ),
        ],
    }
}

pub fn clipboard_failed(error: &str, saved: PathBuf) -> Notice {
    Notice {
        tone: Tone::Error,
        icon: "clipboard-x",
        title: "Could not copy to the clipboard".into(),
        body: format!(
            "Another app may be blocking the clipboard ({error}). Try again in a moment or save the file instead."
        ),
        keys: Vec::new(),
        actions: vec![
            button("Try again", "refresh", true, Handler::CopyAgain(saved.clone())),
            button("Save instead", "download", false, Handler::SaveAs(saved)),
        ],
    }
}

pub fn shortcut_in_use(keys: &str, what: &str) -> Notice {
    Notice {
        tone: Tone::Warning,
        icon: "keyboard",
        title: format!("{keys} is already in use"),
        body: format!(
            "Another app has registered this shortcut, so “{what}” does not work from the keyboard. You can still start it from the menu bar icon."
        ),
        keys: Vec::new(),
        actions: vec![
            button("Open Settings", "settings", true, Handler::OpenSettings),
            dismiss(),
        ],
    }
}

pub fn capture_failed(details: String, mode: CaptureMode, toolbar: bool) -> Notice {
    Notice {
        tone: Tone::Error,
        icon: "scan-line",
        title: "The capture did not work".into(),
        body:
            "The screen could not be captured. This can happen while a display wakes up. Try again."
                .into(),
        keys: Vec::new(),
        actions: vec![
            button(
                "Try again",
                "refresh",
                true,
                Handler::CaptureAgain { mode, toolbar },
            ),
            button("Copy details", "copy", false, Handler::CopyText(details)),
        ],
    }
}

/// Windows only, shown once: the app has no window, so say where it lives and how to start it.
pub fn welcome() -> Notice {
    Notice {
        tone: Tone::Info,
        icon: "logo",
        title: "LumenGrab is running".into(),
        body: "It lives in the system tray. Press the shortcut below anytime to start a capture, from any app."
            .into(),
        keys: vec!["Ctrl", "Shift", "1"],
        actions: vec![
            button("Open Settings", "none", false, Handler::OpenSettings),
            button("Got it", "none", true, Handler::Dismiss),
        ],
    }
}

pub fn trash_failed(error: &str, file: PathBuf) -> Notice {
    Notice {
        tone: Tone::Error,
        icon: "trash",
        title: "Could not move the screenshot to the Trash".into(),
        body: format!("{error}. The file is still where it was."),
        keys: Vec::new(),
        actions: vec![
            button("Show file", "folder", true, Handler::Reveal(file)),
            dismiss(),
        ],
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn frame() -> Arc<Frame> {
        Arc::new(Frame {
            width: 1,
            height: 1,
            rgba: vec![0; 4],
        })
    }

    #[test]
    fn a_failed_save_offers_retry_first_and_choose_folder() {
        let n = save_failed("Pictures/LumenGrab", "denied", frame(), CaptureMode::Area);
        let labels: Vec<_> = n.actions.iter().map(|a| (a.label, a.primary)).collect();
        assert_eq!(labels, [("Retry", true), ("Choose folder…", false)]);
        assert!(n.body.contains("Pictures/LumenGrab"));
        assert_eq!(n.tone, Tone::Error);
    }

    #[test]
    fn the_save_error_names_the_reason_not_the_whole_path_again() {
        let n = save_failed(
            "Pictures/LumenGrab",
            "/Users/x/Pictures/LumenGrab/a.png: Permission denied (os error 13)",
            frame(),
            CaptureMode::Area,
        );
        assert!(
            n.body.contains("(Permission denied (os error 13))"),
            "{}",
            n.body
        );
        assert!(!n.body.contains("/Users/x"), "{}", n.body);
    }

    #[test]
    fn only_one_button_per_notice_is_primary() {
        for n in [
            save_failed("x", "e", frame(), CaptureMode::Window),
            clipboard_failed("e", PathBuf::from("/a.png")),
            shortcut_in_use("Ctrl+Shift+5", "Capture Window"),
            capture_failed("d".into(), CaptureMode::Area, false),
            trash_failed("e", PathBuf::from("/a.png")),
            welcome(),
        ] {
            assert_eq!(
                n.actions.iter().filter(|a| a.primary).count(),
                1,
                "{}",
                n.title
            );
        }
    }

    #[test]
    fn the_welcome_hint_shows_the_main_shortcut_and_is_not_an_error() {
        let n = welcome();
        assert_eq!(n.tone, Tone::Info);
        assert_eq!(n.keys, ["Ctrl", "Shift", "1"]);
        assert_eq!(n.actions.last().map(|a| a.label), Some("Got it"));
        let json = serde_json::to_string(&n.payload()).unwrap();
        assert!(json.contains("\"tone\":\"info\""), "{json}");
    }

    #[test]
    fn the_payload_does_not_leak_the_handlers() {
        let json = serde_json::to_string(
            &capture_failed("secret details".into(), CaptureMode::Area, false).payload(),
        )
        .unwrap();
        assert!(!json.contains("secret details"), "{json}");
        assert!(json.contains("\"label\":\"Try again\""), "{json}");
        assert!(json.contains("\"tone\":\"error\""), "{json}");
    }
}
