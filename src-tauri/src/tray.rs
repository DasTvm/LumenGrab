//! Tray icon with the capture entries, Settings and Quit.

use tauri::{
    menu::{Menu, MenuItem, PredefinedMenuItem},
    tray::TrayIconBuilder,
    AppHandle, Emitter, Manager, WebviewUrl, WebviewWindowBuilder,
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
    let text = MenuItem::with_id(
        app,
        "capture-text",
        "Capture Text",
        true,
        Some("Ctrl+Shift+T"),
    )?;
    let history = MenuItem::with_id(app, "history", "History…", true, Some("Ctrl+Shift+H"))?;
    let pin_last = MenuItem::with_id(
        app,
        "pin-last",
        "Pin last capture",
        true,
        Some("Ctrl+Shift+P"),
    )?;
    let unlock = MenuItem::with_id(
        app,
        "unlock-pins",
        "Unlock pins",
        true,
        Some("Ctrl+Shift+U"),
    )?;
    crate::pin::set_unlock_item(app, unlock.clone());
    let folder = MenuItem::with_id(
        app,
        "open-folder",
        "Open Screenshots Folder",
        true,
        None::<&str>,
    )?;
    let open_document =
        MenuItem::with_id(app, "open-document", "Open Document…", true, None::<&str>)?;
    let recover = MenuItem::with_id(app, "recover", "Recover Unsaved Work…", true, None::<&str>)?;
    let settings = MenuItem::with_id(app, "settings", "Settings…", true, None::<&str>)?;
    // Only a build that can update has the entry; its words follow the state of the updater.
    let update = crate::updater::configured(app)
        .then(|| MenuItem::with_id(app, "update", "Check for Updates…", true, None::<&str>))
        .transpose()?;
    let quit = MenuItem::with_id(app, "quit", "Quit LumenGrab", true, None::<&str>)?;
    let separator = PredefinedMenuItem::separator(app)?;
    let separator_two = PredefinedMenuItem::separator(app)?;
    let separator_three = PredefinedMenuItem::separator(app)?;
    let mut items: Vec<&dyn tauri::menu::IsMenuItem<tauri::Wry>> = vec![
        &bar,
        &separator,
        &area,
        &window,
        &fullscreen,
        &text,
        &separator_two,
        &history,
        &pin_last,
        &unlock,
        &folder,
        &open_document,
        &recover,
        &settings,
    ];
    if let Some(update) = &update {
        items.push(update);
    }
    items.push(&separator_three);
    items.push(&quit);
    let menu = Menu::with_items(app, &items)?;

    let mut tray = TrayIconBuilder::with_id("main")
        .tooltip("LumenGrab")
        .menu(&menu)
        .on_menu_event(|app, event| match event.id.as_ref() {
            "capture" => flow::start_with_bar(app),
            "capture-area" => flow::start(app, CaptureMode::Area, false),
            "capture-window" => flow::start(app, CaptureMode::Window, false),
            "capture-fullscreen" => flow::start(app, CaptureMode::Fullscreen, false),
            "capture-text" => flow::start(app, CaptureMode::Text, false),
            "history" => crate::history::show(app),
            "pin-last" => crate::pin::pin_last(app),
            "unlock-pins" => crate::pin::unlock_all(app),
            "open-folder" => output::open_screenshot_folder(app),
            "open-document" => {
                // The file dialog blocks: not on the thread that runs the menu.
                let app = app.clone();
                std::thread::spawn(move || crate::document::pick_and_open(&app));
            }
            "recover" => crate::recovery::show(app),
            "settings" => show_settings(app),
            "update" => crate::updates_ui::tray_clicked(app),
            "quit" => app.exit(0),
            _ => {}
        });
    if let Some(icon) = tray_icon(app) {
        tray = tray.icon(icon).icon_as_template(cfg!(target_os = "macos"));
    }
    tray.build(app)?;
    if let Some(update) = update {
        crate::updates_ui::set_tray_item(app, update);
    }
    Ok(())
}

/// macOS: the one-colour template mark, which the menu bar tints for light, dark and highlighted.
/// Windows: the full-colour app icon (a black template would vanish on a dark taskbar).
fn tray_icon(app: &AppHandle) -> Option<tauri::image::Image<'_>> {
    #[cfg(target_os = "macos")]
    if let Ok(icon) =
        tauri::image::Image::from_bytes(include_bytes!("../../assets/brand/tray-template@2x.png"))
    {
        return Some(icon);
    }
    app.default_window_icon().cloned()
}

/// Opens the settings window, or focuses it if it already exists.
pub fn show_settings(app: &AppHandle) {
    show_settings_page(app, "general");
}

/// Opens the settings window on a page (`general`, `presentation`, `hotkeys`, `updates`).
pub fn show_settings_page(app: &AppHandle, page: &str) {
    if let Some(window) = app.get_webview_window(SETTINGS_LABEL) {
        let _ = window.show();
        let _ = window.set_focus();
        if page != "general" {
            let _ = app.emit_to(SETTINGS_LABEL, "settings-page", page);
        }
        return;
    }
    let result = WebviewWindowBuilder::new(
        app,
        SETTINGS_LABEL,
        WebviewUrl::App(format!("index.html?window=settings&page={page}").into()),
    )
    .title("LumenGrab Settings")
    .inner_size(1100.0, 720.0)
    .min_inner_size(860.0, 560.0)
    .center()
    .build();
    match result {
        Ok(window) => {
            crate::platform::update_dock_presence(app, None);
            let _ = window.set_focus();
        }
        Err(err) => eprintln!("failed to open settings window: {err}"),
    }
}
