//! The few user settings the native side needs at hotkey time. Stored as JSON in the app config
//! folder; a missing or damaged file silently falls back to the defaults.

use std::{
    fs,
    io::Write,
    path::{Path, PathBuf},
    sync::Mutex,
};

use serde::{Deserialize, Serialize};
use tauri::{AppHandle, Manager};

use crate::capture::CaptureMode;

/// What the main capture shortcut (Ctrl+Shift+1) starts in. Fullscreen is not offered: it would
/// capture at once and the capture bar would never be seen.
#[derive(Clone, Copy, Debug, Default, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum DefaultMode {
    #[default]
    Area,
    Window,
}

impl DefaultMode {
    pub fn capture_mode(self) -> CaptureMode {
        match self {
            Self::Area => CaptureMode::Area,
            Self::Window => CaptureMode::Window,
        }
    }
}

/// How the Quick Access card after a capture looks.
#[derive(Clone, Copy, Debug, Default, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum QuickAccessStyle {
    #[default]
    Compact,
    Large,
}

/// The screen corner the Quick Access cards stack in.
#[derive(Clone, Copy, Debug, Default, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum Corner {
    TopLeft,
    TopRight,
    BottomLeft,
    #[default]
    BottomRight,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", default)]
pub struct QuickAccessSettings {
    pub enabled: bool,
    pub style: QuickAccessStyle,
    /// 0 = never close by itself.
    pub auto_close_secs: u8,
    pub corner: Corner,
}

impl Default for QuickAccessSettings {
    fn default() -> Self {
        Self {
            enabled: true,
            style: QuickAccessStyle::Compact,
            auto_close_secs: 5,
            corner: Corner::BottomRight,
        }
    }
}

/// Everything the user can change. Every field has a default, so an older or partial file still loads.
#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", default)]
pub struct Settings {
    pub default_mode: DefaultMode,
    /// Copy every new screenshot to the clipboard (it is always saved as a file).
    pub copy_to_clipboard: bool,
    pub quick_access: QuickAccessSettings,
    /// The Windows first-start hint was shown (or dismissed).
    pub seen_intro: bool,
}

impl Default for Settings {
    fn default() -> Self {
        Self {
            default_mode: DefaultMode::Area,
            copy_to_clipboard: true,
            quick_access: QuickAccessSettings::default(),
            seen_intro: false,
        }
    }
}

/// The auto-close choices the settings page offers.
const AUTO_CLOSE_CHOICES: [u8; 3] = [0, 5, 10];

impl Settings {
    fn validate(&self) -> Result<(), String> {
        if AUTO_CLOSE_CHOICES.contains(&self.quick_access.auto_close_secs) {
            Ok(())
        } else {
            Err(format!(
                "Close automatically after: {} s is not an available choice.",
                self.quick_access.auto_close_secs
            ))
        }
    }
}

pub struct SettingsStore {
    path: PathBuf,
    data: Mutex<Settings>,
}

impl SettingsStore {
    pub fn load(path: PathBuf) -> Self {
        let data: Settings = fs::read(&path)
            .ok()
            .and_then(|bytes| serde_json::from_slice(&bytes).ok())
            .filter(|s: &Settings| s.validate().is_ok())
            .unwrap_or_default();
        Self {
            path,
            data: Mutex::new(data),
        }
    }

    pub fn get(&self) -> Settings {
        *self.data.lock().expect("settings lock")
    }

    /// Validates, writes (atomically) and only then applies the new settings.
    pub fn save(&self, next: Settings) -> Result<(), String> {
        next.validate()?;
        let mut data = self.data.lock().expect("settings lock");
        write_atomic(&self.path, &next)?;
        *data = next;
        Ok(())
    }

    /// Changes one thing, keeping the rest.
    #[allow(dead_code)] // first used by the Windows first-start hint
    pub fn update(&self, change: impl FnOnce(&mut Settings)) -> Result<(), String> {
        let mut next = self.get();
        change(&mut next);
        self.save(next)
    }
}

/// Temp file in the same folder, then rename, so a crash never leaves half a file.
fn write_atomic(path: &Path, settings: &Settings) -> Result<(), String> {
    let json = serde_json::to_vec_pretty(settings).map_err(|e| e.to_string())?;
    let dir = path.parent().ok_or("The settings folder is unknown.")?;
    fs::create_dir_all(dir).map_err(|e| format!("{}: {e}", dir.display()))?;
    let temp = path.with_extension("json.tmp");
    let write = || -> std::io::Result<()> {
        let mut file = fs::File::create(&temp)?;
        file.write_all(&json)?;
        file.sync_all()?;
        fs::rename(&temp, path)
    };
    write().map_err(|e| {
        let _ = fs::remove_file(&temp);
        format!("{}: {e}", path.display())
    })
}

pub fn init(app: &AppHandle) -> tauri::Result<()> {
    let path = app.path().app_config_dir()?.join("settings.json");
    app.manage(SettingsStore::load(path));
    Ok(())
}

/// The settings page sends the whole object; serde rejects unknown choices.
#[tauri::command]
pub fn settings_save(store: tauri::State<SettingsStore>, settings: Settings) -> Result<(), String> {
    store.save(settings)
}

#[cfg(test)]
mod tests {
    use super::*;

    fn temp_path(name: &str) -> PathBuf {
        let dir =
            std::env::temp_dir().join(format!("lumengrab-settings-{name}-{}", std::process::id()));
        let _ = fs::remove_dir_all(&dir);
        dir.join("settings.json")
    }

    #[test]
    fn defaults_match_the_design() {
        let s = SettingsStore::load(temp_path("none")).get();
        assert_eq!(s.default_mode, DefaultMode::Area);
        assert!(s.copy_to_clipboard);
        assert_eq!(
            s.quick_access,
            QuickAccessSettings {
                enabled: true,
                style: QuickAccessStyle::Compact,
                auto_close_secs: 5,
                corner: Corner::BottomRight
            }
        );
        assert!(!s.seen_intro);
    }

    #[test]
    fn a_damaged_file_falls_back_to_the_defaults() {
        let path = temp_path("bad");
        fs::create_dir_all(path.parent().unwrap()).unwrap();
        fs::write(&path, b"{ not json").unwrap();
        assert_eq!(SettingsStore::load(path).get(), Settings::default());
    }

    #[test]
    fn the_choices_survive_a_restart() {
        let path = temp_path("roundtrip");
        let store = SettingsStore::load(path.clone());
        store
            .update(|s| {
                s.default_mode = DefaultMode::Window;
                s.copy_to_clipboard = false;
                s.quick_access.style = QuickAccessStyle::Large;
                s.quick_access.corner = Corner::TopLeft;
                s.quick_access.auto_close_secs = 10;
            })
            .unwrap();
        let again = SettingsStore::load(path).get();
        assert_eq!(again.default_mode, DefaultMode::Window);
        assert!(!again.copy_to_clipboard);
        assert_eq!(again.quick_access.style, QuickAccessStyle::Large);
        assert_eq!(again.quick_access.corner, Corner::TopLeft);
        assert_eq!(again.quick_access.auto_close_secs, 10);
    }

    #[test]
    fn a_file_from_an_older_version_keeps_working() {
        // M1 wrote only `defaultMode`; everything new must come from the defaults.
        let path = temp_path("old");
        fs::create_dir_all(path.parent().unwrap()).unwrap();
        fs::write(&path, br#"{ "defaultMode": "window" }"#).unwrap();
        let s = SettingsStore::load(path).get();
        assert_eq!(s.default_mode, DefaultMode::Window);
        assert!(s.copy_to_clipboard);
        assert_eq!(s.quick_access, QuickAccessSettings::default());
    }

    #[test]
    fn a_file_with_extra_unknown_fields_still_loads() {
        let path = temp_path("future");
        fs::create_dir_all(path.parent().unwrap()).unwrap();
        fs::write(
            &path,
            br#"{ "copyToClipboard": false, "somethingFromTheFuture": 1 }"#,
        )
        .unwrap();
        assert!(!SettingsStore::load(path).get().copy_to_clipboard);
    }

    #[test]
    fn unavailable_choices_are_rejected_not_guessed() {
        assert!(serde_json::from_str::<DefaultMode>("\"fullscreen\"").is_err());
        assert!(serde_json::from_str::<Corner>("\"middle\"").is_err());
        let store = SettingsStore::load(temp_path("reject"));
        let err = store
            .update(|s| s.quick_access.auto_close_secs = 7)
            .unwrap_err();
        assert!(err.contains("7"), "{err}");
        assert_eq!(store.get().quick_access.auto_close_secs, 5, "unchanged");
    }

    #[test]
    fn corners_are_written_in_camel_case_for_the_frontend() {
        let json = serde_json::to_string(&Settings::default()).unwrap();
        assert!(json.contains("\"corner\":\"bottomRight\""), "{json}");
        assert!(json.contains("\"autoCloseSecs\":5"), "{json}");
    }
}
