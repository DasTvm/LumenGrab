//! Tray icon with the capture entries, Settings and Quit.

use tauri::{
    menu::{Menu, MenuItem, PredefinedMenuItem},
    tray::TrayIconBuilder,
    AppHandle, Manager, WebviewUrl, WebviewWindowBuilder,
};

use crate::capture::{flow, CaptureMode};

const SETTINGS_LABEL: &str = "settings";

pub fn init(app: &AppHandle) -> tauri::Result<()> {
    // The accelerator text only shows the shortcut; the real hotkeys are registered in `hotkeys`.
    let area = MenuItem::with_id(
        app,
        "capture-area",
        "Capture Area",
        true,
        Some("Ctrl+Shift+4"),
    )?;
    let window = MenuItem::with_id(
        app,
        "capture-window",
        "Capture Window",
        true,
        Some("Ctrl+Shift+5"),
    )?;
    let fullscreen = MenuItem::with_id(
        app,
        "capture-fullscreen",
        "Capture Fullscreen",
        true,
        Some("Ctrl+Shift+3"),
    )?;
    let settings = MenuItem::with_id(app, "settings", "Settings…", true, None::<&str>)?;
    let quit = MenuItem::with_id(app, "quit", "Quit LumenGrab", true, None::<&str>)?;
    let menu = Menu::with_items(
        app,
        &[
            &area,
            &window,
            &fullscreen,
            &PredefinedMenuItem::separator(app)?,
            &settings,
            &PredefinedMenuItem::separator(app)?,
            &quit,
        ],
    )?;

    let mut tray = TrayIconBuilder::with_id("main")
        .tooltip("LumenGrab")
        .menu(&menu)
        .on_menu_event(|app, event| match event.id.as_ref() {
            "capture-area" => flow::start(app, CaptureMode::Area),
            "capture-window" => flow::start(app, CaptureMode::Window),
            "capture-fullscreen" => flow::start(app, CaptureMode::Fullscreen),
            "settings" => show_settings(app),
            "quit" => app.exit(0),
            _ => {}
        });
    if let Some(icon) = app.default_window_icon() {
        tray = tray.icon(icon.clone());
    }
    tray.build(app)?;
    Ok(())
}

/// Opens the settings window, or focuses it if it already exists.
fn show_settings(app: &AppHandle) {
    if let Some(window) = app.get_webview_window(SETTINGS_LABEL) {
        let _ = window.show();
        let _ = window.set_focus();
        return;
    }
    let result = WebviewWindowBuilder::new(
        app,
        SETTINGS_LABEL,
        WebviewUrl::App("index.html?window=settings".into()),
    )
    .title("LumenGrab Settings")
    .inner_size(560.0, 420.0)
    .build();
    if let Err(err) = result {
        eprintln!("failed to open settings window: {err}");
    }
}
