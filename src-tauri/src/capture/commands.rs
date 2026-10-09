//! Tauri commands used by the overlay windows. Typed wrappers live in `src/platform/native.ts`.

use serde::Serialize;
use tauri::{AppHandle, Manager, State};

use super::{flow, geometry, overlay, store::CaptureStore, CaptureMode, PxRect};
use crate::platform;

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct OverlayDisplay {
    id: u32,
    name: String,
    pixel_width: u32,
    pixel_height: u32,
    scale: f64,
}

/// A selectable window, in pixels relative to the overlay's display.
#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct OverlayWindow {
    id: u32,
    title: String,
    app_name: String,
    x: u32,
    y: u32,
    width: u32,
    height: u32,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct OverlaySession {
    /// The current mode (may differ from the start mode if the capture bar switched it).
    mode: CaptureMode,
    /// The capture is started with the capture bar: the mode can be switched (bar or keys A/W/F).
    toolbar: bool,
    /// This display shows the bar and the hint; the others stay clean.
    home: bool,
    display: OverlayDisplay,
    /// Path for the `lgcapture` URI scheme; the frontend turns it into a URL.
    frame_key: String,
    /// Front to back.
    windows: Vec<OverlayWindow>,
}

#[tauri::command]
pub fn capture_overlay_session(
    store: State<CaptureStore>,
    session: String,
    display: u32,
) -> Result<Option<OverlaySession>, String> {
    // Overlay windows are created while the displays are still being captured: `None` means "not
    // ready yet, ask again" (the frontend polls). An unknown id is a real error.
    let Some(s) = store.get(&session) else {
        return if store.is_pending(&session) {
            Ok(None)
        } else {
            Err("This capture is no longer active.".into())
        };
    };
    let d = s
        .display(display)
        .ok_or("This display is no longer available.")?;
    let windows = geometry::windows_on_display(&d.info, &s.windows)
        .into_iter()
        .filter_map(|(id, r)| {
            let w = s.windows.iter().find(|w| w.id == id)?;
            Some(OverlayWindow {
                id,
                title: w.title.clone(),
                app_name: w.app_name.clone(),
                x: r.x,
                y: r.y,
                width: r.width,
                height: r.height,
            })
        })
        .collect();
    Ok(Some(OverlaySession {
        mode: s.live_mode(),
        toolbar: s.toolbar,
        home: d.info.id == s.home_display,
        display: OverlayDisplay {
            id: d.info.id,
            name: d.info.name.clone(),
            pixel_width: d.info.pixel_width,
            pixel_height: d.info.pixel_height,
            scale: d.info.scale,
        },
        frame_key: format!("{session}-{display}"),
        windows,
    }))
}

/// The overlay has painted its frame: show it. The one under the cursor takes keyboard focus.
#[tauri::command]
pub fn capture_overlay_ready(
    app: AppHandle,
    store: State<CaptureStore>,
    session: String,
    display: u32,
) {
    let Some(s) = store.get(&session) else { return };
    let Some(d) = s.display(display) else { return };
    let focus = platform::cursor_position(&app).and_then(|(x, y)| {
        geometry::display_at_point(
            &s.displays
                .iter()
                .map(|d| d.info.clone())
                .collect::<Vec<_>>(),
            x,
            y,
        )
        .map(|c| c.id)
    }) == Some(display);
    overlay::show(&app, &d.info, focus);
    eprintln!(
        "[lumengrab] overlay on display {display} visible {} ms after the capture started",
        s.started.elapsed().as_millis()
    );
    #[cfg(any(debug_assertions, feature = "dev-hooks"))]
    if focus {
        crate::dev::autosubmit(&app, &s, &d.info);
    }
}

/// A freshly loaded (warm) overlay window asks which capture it belongs to, if one is already running.
#[tauri::command]
pub fn capture_overlay_assignment(app: AppHandle) -> Option<String> {
    overlay::assignment(&app)
}

#[tauri::command]
pub fn capture_submit_area(
    app: AppHandle,
    session: String,
    display: u32,
    rect: PxRect,
) -> Result<(), String> {
    flow::submit_area(&app, &session, display, rect).map_err(|e| e.to_string())
}

#[tauri::command]
pub fn capture_submit_window(
    app: AppHandle,
    session: String,
    window_id: u32,
) -> Result<(), String> {
    flow::submit_window(&app, &session, window_id).map_err(|e| e.to_string())
}

#[tauri::command]
pub fn capture_cancel(app: AppHandle, session: String) {
    flow::finish(&app, &session);
}

#[tauri::command]
pub fn capture_start(app: AppHandle, mode: CaptureMode, toolbar: Option<bool>) {
    flow::start(&app, mode, toolbar.unwrap_or(false));
}

#[tauri::command]
pub fn capture_set_mode(app: AppHandle, session: String, mode: CaptureMode) -> Result<(), String> {
    flow::set_mode(&app, &session, mode).map_err(|e| e.to_string())
}

/// Serves frozen frames to the overlay as `lgcapture://localhost/<session>-<display>`
/// (`http://lgcapture.localhost/...` on Windows). In memory, no disk, no base64 over IPC.
pub fn serve_frame(app: &AppHandle, path: &str) -> Option<Vec<u8>> {
    let key = path.trim_start_matches('/');
    let (session, display) = key.rsplit_once('-')?;
    let display: u32 = display.parse().ok()?;
    let store = app.state::<CaptureStore>();
    let s = store.get(session)?;
    let png = s.display(display)?.png()?;
    Some(png.as_ref().clone())
}

/// Everything the settings window shows that only the native side knows.
#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SettingsInfo {
    save_dir: String,
    /// What the main shortcut starts in: `area` or `window`.
    default_mode: crate::settings::DefaultMode,
    hotkeys: Vec<crate::hotkeys::HotkeyInfo>,
}

#[tauri::command]
pub fn settings_info(app: AppHandle) -> Result<SettingsInfo, String> {
    let failures = app.state::<crate::hotkeys::HotkeyFailures>();
    Ok(SettingsInfo {
        save_dir: super::output::screenshot_dir(&app)?.display().to_string(),
        default_mode: app
            .state::<crate::settings::SettingsStore>()
            .get()
            .default_mode,
        hotkeys: crate::hotkeys::list(&failures.0),
    })
}

#[tauri::command]
pub fn open_screenshots_folder(app: AppHandle) {
    super::output::open_screenshot_folder(&app);
}
