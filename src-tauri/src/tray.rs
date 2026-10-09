//! Tray icon with the capture entries, Settings and Quit.

use tauri::{
    menu::{Menu, MenuItem, PredefinedMenuItem},
    tray::TrayIconBuilder,
    AppHandle, Manager, WebviewUrl, WebviewWindowBuilder,
};

use crate::capture::{flow, output, CaptureMode};

const SETTINGS_LABEL: &str = "settings";

pub fn init(app: &AppHandle) -> tauri::Result<()> {
    // The accelerator text only shows the shortcut; the real hotkeys are registered in `hotkeys`.
    let bar = MenuItem::with_id(app, "capture", "Capture…", true, Some("Ctrl+Shift+1"))?;
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
    let folder = MenuItem::with_id(
        app,
        "open-folder",
        "Open Screenshots Folder",
        true,
        None::<&str>,
    )?;
    let settings = MenuItem::with_id(app, "settings", "Settings…", true, None::<&str>)?;
    let quit = MenuItem::with_id(app, "quit", "Quit LumenGrab", true, None::<&str>)?;
    let menu = Menu::with_items(
        app,
        &[
            &bar,
            &PredefinedMenuItem::separator(app)?,
            &area,
            &window,
            &fullscreen,
            &PredefinedMenuItem::separator(app)?,
            &folder,
            &settings,
            &PredefinedMenuItem::separator(app)?,
            &quit,
        ],
    )?;

    let mut tray = TrayIconBuilder::with_id("main")
        .tooltip("LumenGrab")
        .menu(&menu)
        .on_menu_event(|app, event| match event.id.as_ref() {
            "capture" => flow::start_with_bar(app),
            "capture-area" => flow::start(app, CaptureMode::Area, false),
            "capture-window" => flow::start(app, CaptureMode::Window, false),
            "capture-fullscreen" => flow::start(app, CaptureMode::Fullscreen, false),
            "open-folder" => output::open_screenshot_folder(app),
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
pub fn show_settings(app: &AppHandle) {
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
    .inner_size(1100.0, 720.0)
    .min_inner_size(860.0, 560.0)
    .center()
    .build();
    if let Err(err) = result {
        eprintln!("failed to open settings window: {err}");
    }
}
