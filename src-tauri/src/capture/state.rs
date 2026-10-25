//! What the capture remembers between captures: the size of the last selected area, so "repeat the
//! last area" can take the same size again. A small JSON file in the config folder; a missing or damaged
//! file just means "nothing remembered".

use std::{fs, path::PathBuf};

use serde::{Deserialize, Serialize};
use tauri::AppHandle;

/// A size in logical pixels (points), so it means the same on a 1x and a 2x display.
#[derive(Clone, Copy, Debug, PartialEq, Serialize, Deserialize)]
pub struct AreaSize {
    pub width: f64,
    pub height: f64,
}

#[derive(Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", default)]
struct State {
    last_area: Option<AreaSize>,
}

fn path(app: &AppHandle) -> Option<PathBuf> {
    crate::settings::config_dir(app)
        .ok()
        .map(|d| d.join("capture_state.json"))
}

fn read(path: &PathBuf) -> State {
    fs::read(path)
        .ok()
        .and_then(|bytes| serde_json::from_slice(&bytes).ok())
        .unwrap_or_default()
}

/// A selection of `width` x `height` device pixels on a display of this scale, in logical pixels.
/// `None` for a selection that cannot be repeated (empty, or a scale that makes no sense).
pub fn logical_size(width_px: u32, height_px: u32, scale: f64) -> Option<AreaSize> {
    if width_px == 0 || height_px == 0 || !scale.is_finite() || scale <= 0.0 {
        return None;
    }
    Some(AreaSize {
        width: (f64::from(width_px) / scale).round(),
        height: (f64::from(height_px) / scale).round(),
    })
}

pub fn last_area(app: &AppHandle) -> Option<AreaSize> {
    path(app).and_then(|p| read(&p).last_area)
}

/// Remembers the size of the area that was just taken.
pub fn remember_area(app: &AppHandle, width_px: u32, height_px: u32, scale: f64) {
    let (Some(path), Some(size)) = (path(app), logical_size(width_px, height_px, scale)) else {
        return;
    };
    let state = State {
        last_area: Some(size),
    };
    if let Ok(json) = serde_json::to_vec(&state) {
        if let Some(dir) = path.parent() {
            let _ = fs::create_dir_all(dir);
        }
        let _ = crate::fsutil::write_atomic(&path, &json);
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn a_selection_is_remembered_in_logical_pixels() {
        assert_eq!(
            logical_size(2560, 1440, 2.0),
            Some(AreaSize {
                width: 1280.0,
                height: 720.0
            })
        );
        assert_eq!(
            logical_size(1280, 720, 1.0),
            Some(AreaSize {
                width: 1280.0,
                height: 720.0
            })
        );
    }

    #[test]
    fn nothing_that_cannot_be_repeated_is_remembered() {
        assert_eq!(logical_size(0, 100, 1.0), None);
        assert_eq!(logical_size(100, 0, 1.0), None);
        assert_eq!(logical_size(100, 100, 0.0), None);
        assert_eq!(logical_size(100, 100, f64::NAN), None);
    }

    #[test]
    fn a_damaged_file_means_nothing_is_remembered() {
        let dir = std::env::temp_dir().join(format!("lumengrab-state-{}", std::process::id()));
        let _ = fs::remove_dir_all(&dir);
        fs::create_dir_all(&dir).unwrap();
        let file = dir.join("capture_state.json");
        fs::write(&file, b"{ not json").unwrap();
        assert_eq!(read(&file).last_area, None);
        fs::write(
            &file,
            br#"{"lastArea":{"width":640.0,"height":480.0},"later":1}"#,
        )
        .unwrap();
        assert_eq!(
            read(&file).last_area,
            Some(AreaSize {
                width: 640.0,
                height: 480.0
            })
        );
    }
}
