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
    /// A new version: a lime icon and an accent button (design: Update ready).
    Update,
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
    /// Opens a link from a QR code after a native question that shows the whole address.
    OpenLinkAsking(String),
    /// Windows: the settings page where an OCR language pack is added.
    OpenLanguageSettings,
    /// Copies the saved file to the clipboard again.
    CopyAgain(PathBuf),
    /// Opens the "Save as…" dialog for a saved file.
    SaveAs(PathBuf),
    /// Puts the default look on a screenshot that was saved without it.
    ApplyLook(PathBuf),
    /// Starts downloading the update that was announced (the card turns into the progress card).
    UpdateDownload,
    /// Stops the download.
    UpdateCancel,
    /// Installs the downloaded update and restarts (asks about unsaved documents first).
    UpdateRestart,
    /// Looks for an update again.
    UpdateCheck,
    /// Opens a web page (the release notes, the downloads) and leaves the card.
    OpenUrl(String),
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

/// A progress bar on a card (the update download): `fraction` is `None` while the size is not known.
#[derive(Clone, Serialize)]
pub struct Progress {
    pub fraction: Option<f32>,
    pub text: String,
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
    pub progress: Option<Progress>,
    pub actions: Vec<Action>,
    /// Closes by itself after this many seconds (a result, not a problem); 0 = stays until dealt with.
    pub auto_close_secs: u8,
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
    #[serde(skip_serializing_if = "Option::is_none")]
    pub progress: Option<Progress>,
    pub actions: Vec<ActionPayload>,
    pub auto_close_secs: u8,
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
            progress: self.progress.clone(),
            actions: self
                .actions
                .iter()
                .map(|a| ActionPayload {
                    label: a.label,
                    icon: a.icon,
                    primary: a.primary,
                })
                .collect(),
            auto_close_secs: self.auto_close_secs,
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
        progress: None,
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
        auto_close_secs: 0,
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
        progress: None,
        actions: vec![
            button("Try again", "refresh", true, Handler::CopyAgain(saved.clone())),
            button("Save instead", "download", false, Handler::SaveAs(saved)),
        ],
        auto_close_secs: 0,
    }
}

/// The automatic look could not be drawn in time: the screenshot was delivered as it was.
pub fn look_failed(saved: PathBuf) -> Notice {
    Notice {
        tone: Tone::Warning,
        icon: "triangle-alert",
        title: "Could not apply your look".into(),
        body: "Your screenshot is saved and copied as it is. You can put the look on it now, or edit it later.".into(),
        keys: Vec::new(),
        progress: None,
        actions: vec![
            button("Try again", "refresh", true, Handler::ApplyLook(saved)),
            dismiss(),
        ],
        auto_close_secs: 0,
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
        progress: None,
        actions: vec![
            button("Open Settings", "settings", true, Handler::OpenSettings),
            dismiss(),
        ],
        auto_close_secs: 0,
    }
}

// ---- text recognition (docs/adr/0012) -------------------------------------------------------------

fn text_notice(icon: &'static str, title: String, body: &str, actions: Vec<Action>) -> Notice {
    Notice {
        tone: Tone::Info,
        icon,
        title,
        body: body.into(),
        keys: Vec::new(),
        progress: None,
        actions,
        auto_close_secs: 0,
    }
}

/// The text was copied: a result, so the card closes by itself.
pub fn text_copied(words: usize) -> Notice {
    let mut notice = text_notice(
        "scan-text",
        format!(
            "{words} {} copied",
            if words == 1 { "word" } else { "words" }
        ),
        "Paste it anywhere",
        vec![],
    );
    notice.auto_close_secs = 5;
    notice
}

pub fn no_text() -> Notice {
    let mut notice = text_notice(
        "scan-text",
        "No text found".into(),
        "Try a larger area or a sharper picture",
        vec![dismiss()],
    );
    notice.auto_close_secs = 6;
    notice
}

/// A QR code with a web address was found (and the text around it, if any, is on the clipboard).
pub fn qr_found(link: String) -> Notice {
    let shown = link
        .trim_start_matches("https://")
        .trim_start_matches("http://")
        .to_string();
    text_notice(
        "scan-text",
        "QR code found".into(),
        &shown,
        vec![
            button("Copy", "copy", false, Handler::CopyText(link.clone())),
            button("Open", "none", true, Handler::OpenLinkAsking(link)),
        ],
    )
}

pub fn text_failed(details: String) -> Notice {
    let mut notice = text_notice(
        "triangle-alert",
        "Could not read the text".into(),
        "Text recognition failed. Nothing was copied.",
        vec![
            button("Copy details", "copy", false, Handler::CopyText(details)),
            dismiss(),
        ],
    );
    notice.tone = Tone::Error;
    notice
}

pub fn no_language_pack() -> Notice {
    let mut notice = text_notice(
        "triangle-alert",
        "No language pack for text recognition".into(),
        "Windows needs one to read text. It is a free download from Microsoft.",
        vec![
            button(
                "Open language settings",
                "settings",
                true,
                Handler::OpenLanguageSettings,
            ),
            dismiss(),
        ],
    );
    notice.tone = Tone::Warning;
    notice
}

pub fn pin_limit() -> Notice {
    Notice {
        tone: Tone::Info,
        icon: "pin",
        title: "8 pins are already on screen".into(),
        body: "Close one to pin another capture. Pins stay until you close them.".into(),
        keys: Vec::new(),
        progress: None,
        actions: vec![button("Got it", "none", true, Handler::Dismiss)],
        auto_close_secs: 0,
    }
}

pub fn nothing_to_pin() -> Notice {
    Notice {
        tone: Tone::Info,
        icon: "pin",
        title: "Nothing to pin yet".into(),
        body: "Take a capture first. The newest one in your history is what “Pin last capture” floats.".into(),
        keys: Vec::new(),
        progress: None,
        actions: vec![button("Got it", "none", true, Handler::Dismiss)],
        auto_close_secs: 0,
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
        progress: None,
        actions: vec![
            button(
                "Try again",
                "refresh",
                true,
                Handler::CaptureAgain { mode, toolbar },
            ),
            button("Copy details", "copy", false, Handler::CopyText(details)),
        ],
        auto_close_secs: 0,
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
        progress: None,
        actions: vec![
            button("Open Settings", "none", false, Handler::OpenSettings),
            button("Got it", "none", true, Handler::Dismiss),
        ],
        auto_close_secs: 0,
    }
}

pub fn trash_failed(error: &str, file: PathBuf) -> Notice {
    Notice {
        tone: Tone::Error,
        icon: "trash",
        title: "Could not move the screenshot to the Trash".into(),
        body: format!("{error}. The file is still where it was."),
        keys: Vec::new(),
        progress: None,
        actions: vec![
            button("Show file", "folder", true, Handler::Reveal(file)),
            dismiss(),
        ],
        auto_close_secs: 0,
    }
}

// ---- updates (docs/adr/0008) -----------------------------------------------------------------------

fn update(title: String, body: &str, progress: Option<Progress>, actions: Vec<Action>) -> Notice {
    Notice {
        tone: Tone::Update,
        icon: "refresh-cw",
        title,
        body: body.into(),
        keys: Vec::new(),
        progress,
        actions,
        auto_close_secs: 0,
    }
}

/// A new version was found (the daily check): download it when the user says so.
pub fn update_available(version: &str) -> Notice {
    update(
        format!("LumenGrab {version} is here"),
        "It downloads in the background and restarts when you choose.",
        None,
        vec![
            button("Install and restart", "none", true, Handler::UpdateDownload),
            button("Later", "none", false, Handler::Dismiss),
            button(
                "See what's new",
                "none",
                false,
                Handler::OpenUrl(release_url(version)),
            ),
        ],
    )
}

pub fn update_downloading(version: &str, text: String, fraction: Option<f32>) -> Notice {
    update(
        format!("Downloading LumenGrab {version}"),
        "You can keep working. We'll tell you when it is ready.",
        Some(Progress { fraction, text }),
        vec![button("Cancel", "none", false, Handler::UpdateCancel)],
    )
}

pub fn update_ready() -> Notice {
    update(
        "A new version of LumenGrab is ready".into(),
        "It installs in the background and restarts when you choose.",
        None,
        vec![
            button("Install and restart", "none", true, Handler::UpdateRestart),
            button("Later", "none", false, Handler::Dismiss),
        ],
    )
}

/// The update did not work: what a person can do about it depends on why.
pub fn update_failed(reason: crate::updater::FailReason) -> Notice {
    use crate::updater::FailReason as R;
    let (title, body, second) = match reason {
        R::Signature => (
            "Update failed: security check",
            "The update did not pass its signature check, so it was not installed. Your current version is untouched.",
            button(
                "Download manually",
                "none",
                false,
                Handler::OpenUrl(DOWNLOADS_URL.into()),
            ),
        ),
        R::Disk => (
            "Update failed: not enough space",
            "There is not enough free disk space for the update. Free some up and try again.",
            dismiss_as("Later"),
        ),
        R::Network | R::Other => (
            "Update failed: no connection",
            "LumenGrab couldn't download the update. Check your internet connection and try again.",
            dismiss_as("Later"),
        ),
    };
    Notice {
        tone: Tone::Error,
        icon: "triangle-alert",
        title: title.into(),
        body: body.into(),
        keys: Vec::new(),
        progress: None,
        actions: vec![
            button("Try again", "none", true, Handler::UpdateCheck),
            second,
        ],
        auto_close_secs: 0,
    }
}

fn dismiss_as(label: &'static str) -> Action {
    button(label, "none", false, Handler::Dismiss)
}

/// The page of a release on GitHub.
pub fn release_url(version: &str) -> String {
    format!("https://github.com/DasTvm/LumenGrab/releases/tag/v{version}")
}

/// Where to get the installers by hand.
pub const DOWNLOADS_URL: &str = "https://github.com/DasTvm/LumenGrab/releases/latest";

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
