//! Tray icon with a minimal menu: Capture, Settings, Quit.

use tauri::{
    menu::{Menu, MenuItem, PredefinedMenuItem},
    tray::TrayIconBuilder,
    AppHandle, Manager, WebviewUrl, WebviewWindowBuilder,
};

const SETTINGS_LABEL: &str = "settings";

pub fn init(app: &AppHandle) -> tauri::Result<()> {
    // Capture is wired up in M1; until then the item is visible but disabled.
    let capture = MenuItem::with_id(app, "capture", "Capture", false, None::<&str>)?;
    let settings = MenuItem::with_id(app, "settings", "Settings…", true, None::<&str>)?;
    let quit = MenuItem::with_id(app, "quit", "Quit LumenGrab", true, None::<&str>)?;
    let separator = PredefinedMenuItem::separator(app)?;
    let menu = Menu::with_items(app, &[&capture, &settings, &separator, &quit])?;

    let mut tray = TrayIconBuilder::with_id("main")
        .tooltip("LumenGrab")
        .menu(&menu)
        .on_menu_event(|app, event| match event.id.as_ref() {
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
