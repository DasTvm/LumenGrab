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

#[derive(Clone, Copy, Debug, Default, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", default)]
pub struct Settings {
    pub default_mode: DefaultMode,
}

pub struct SettingsStore {
    path: PathBuf,
    data: Mutex<Settings>,
}

impl SettingsStore {
    pub fn load(path: PathBuf) -> Self {
        let data = fs::read(&path)
            .ok()
            .and_then(|bytes| serde_json::from_slice(&bytes).ok())
            .unwrap_or_default();
        Self {
            path,
            data: Mutex::new(data),
        }
    }

    pub fn get(&self) -> Settings {
        *self.data.lock().expect("settings lock")
    }

    pub fn set_default_mode(&self, mode: DefaultMode) -> Result<(), String> {
        let mut data = self.data.lock().expect("settings lock");
        let next = Settings { default_mode: mode };
        write_atomic(&self.path, &next)?;
        *data = next;
        Ok(())
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

#[tauri::command]
pub fn settings_set_default_mode(
    store: tauri::State<SettingsStore>,
    mode: DefaultMode,
) -> Result<(), String> {
    store.set_default_mode(mode)
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
    fn defaults_to_area_when_there_is_no_file() {
        let store = SettingsStore::load(temp_path("none"));
        assert_eq!(store.get().default_mode, DefaultMode::Area);
    }

    #[test]
    fn a_damaged_file_falls_back_to_the_defaults() {
        let path = temp_path("bad");
        fs::create_dir_all(path.parent().unwrap()).unwrap();
        fs::write(&path, b"{ not json").unwrap();
        assert_eq!(
            SettingsStore::load(path).get().default_mode,
            DefaultMode::Area
        );
    }

    #[test]
    fn the_choice_survives_a_restart() {
        let path = temp_path("roundtrip");
        let store = SettingsStore::load(path.clone());
        store.set_default_mode(DefaultMode::Window).unwrap();
        assert_eq!(store.get().default_mode, DefaultMode::Window);
        assert_eq!(
            SettingsStore::load(path).get().default_mode,
            DefaultMode::Window
        );
    }

    #[test]
    fn unknown_values_are_rejected_not_guessed() {
        assert!(serde_json::from_str::<DefaultMode>("\"fullscreen\"").is_err());
        assert_eq!(
            serde_json::from_str::<Settings>("{}").unwrap().default_mode,
            DefaultMode::Area
        );
    }
}
