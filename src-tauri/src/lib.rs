//! LumenGrab native shell. Kept thin on purpose: product logic lives in TypeScript.
//! M0 only provides the tray icon, its menu and the settings window placeholder.

mod tray;

pub fn run() {
    tauri::Builder::default()
        .setup(|app| {
            tray::init(app.handle())?;
            Ok(())
        })
        .build(tauri::generate_context!())
        .expect("error while building tauri application")
        .run(|_app, event| {
            // This is a tray app: closing the last window (settings) must not quit it.
            // `code` is `None` for implicit exits; an explicit `app.exit()` (Quit) passes through.
            if let tauri::RunEvent::ExitRequested { api, code, .. } = event {
                if code.is_none() {
                    api.prevent_exit();
                }
            }
        });
}
