//! LumenGrab native shell. Kept thin on purpose: product logic lives in TypeScript.

mod capture;
#[cfg(any(debug_assertions, feature = "dev-hooks"))]
mod dev;
mod document;
mod fsutil;
mod hotkeys;
mod permission;
mod platform;
mod quick_access;
mod settings;
mod tray;

use std::{borrow::Cow, sync::Arc};

use tauri::{Manager, WindowEvent};

use capture::{backend, commands, overlay, store::CaptureStore, Capturer};

pub fn run() {
    let builder = tauri::Builder::default();
    // A second launch (a double-click on a .lumengrab file while the app runs in the tray) must not
    // start another process: it hands its arguments to the running one. First plugin, as required.
    // Not in dev builds, so `tauri dev` can run next to an installed copy.
    #[cfg(not(any(debug_assertions, feature = "dev-hooks")))]
    let builder = builder.plugin(tauri_plugin_single_instance::init(|app, args, _cwd| {
        let handle = app.clone();
        let _ = app.run_on_main_thread(move || document::open_args(&handle, args));
    }));
    builder
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_clipboard_manager::init())
        .plugin(hotkeys::plugin())
        .manage(CaptureStore::default())
        .manage(document::Documents::default())
        .manage(overlay::Pool::default())
        .manage(quick_access::QuickAccess::default())
        .manage::<Arc<dyn Capturer>>(backend::default_capturer())
        // Frozen frames for the overlay windows, served from memory.
        .register_uri_scheme_protocol("lgcapture", |ctx, request| {
            let body = commands::serve_frame(ctx.app_handle(), request.uri().path());
            let status = if body.is_some() { 200 } else { 404 };
            tauri::http::Response::builder()
                .status(status)
                .header("Content-Type", "image/png")
                .header("Cache-Control", "no-store")
                .header("Access-Control-Allow-Origin", "*")
                .body(Cow::Owned(body.unwrap_or_default()))
                .expect("static response headers are valid")
        })
        .invoke_handler(tauri::generate_handler![
            commands::capture_start,
            commands::capture_overlay_session,
            commands::capture_overlay_ready,
            commands::capture_overlay_assignment,
            commands::capture_submit_area,
            commands::capture_submit_window,
            commands::capture_cancel,
            quick_access::commands::quick_access_card,
            quick_access::commands::quick_access_size,
            quick_access::commands::quick_access_close,
            quick_access::commands::quick_access_delete,
            quick_access::commands::quick_access_notice_action,
            quick_access::commands::quick_access_drag,
            quick_access::commands::quick_access_undo_delete,
            quick_access::commands::quick_access_copy,
            quick_access::commands::quick_access_reveal,
            quick_access::commands::quick_access_file_bytes,
            commands::capture_set_mode,
            settings::settings_save,
            commands::settings_info,
            commands::open_screenshots_folder,
            permission::permission_status,
            permission::permission_open_settings,
            permission::permission_close,
            permission::restart_app,
            permission::quit_app,
            document::document_info,
            document::document_load,
            document::document_reveal,
            document::document_close,
            document::reveal_written_file,
            document::document_pick_open,
            document::pick_save_target,
            document::write_granted_file,
            document::open_url,
        ])
        .on_window_event(|window, event| {
            // An overlay closed by the OS or the user must not leave the capture stuck "busy".
            if let WindowEvent::Destroyed = event {
                overlay::on_destroyed(window.app_handle(), window.label());
                document::on_destroyed(window.app_handle(), window.label());
            }
        })
        .setup(|app| {
            platform::setup_app(app);
            settings::init(app.handle())?;
            tray::init(app.handle())?;
            // First run (or after an update that reset it): explain the Screen Recording permission.
            #[cfg(not(any(debug_assertions, feature = "dev-hooks")))]
            if !app.state::<Arc<dyn Capturer>>().permission_granted() {
                permission::show(app.handle());
            }
            if app.state::<Arc<dyn Capturer>>().permission_granted() {
                permission::remember_granted();
            }
            overlay::warm_up(app.handle());
            quick_access::warm_up(app.handle());
            // Windows has no permission window to say hello: tell the user once where the app lives.
            #[cfg(target_os = "windows")]
            {
                let handle = app.handle().clone();
                std::thread::spawn(move || {
                    std::thread::sleep(std::time::Duration::from_millis(2500));
                    quick_access::show_intro(&handle, false);
                });
            }
            // Windows (and Linux) pass a double-clicked file as an argument on the first launch.
            document::open_args(app.handle(), std::env::args().skip(1));
            hotkeys::start_escape_worker(app.handle());
            let failed = hotkeys::register(app.handle());
            app.manage(hotkeys::HotkeyFailures(failed));
            #[cfg(any(debug_assertions, feature = "dev-hooks"))]
            dev::autostart(app.handle());
            Ok(())
        })
        .build(tauri::generate_context!())
        .expect("error while building tauri application")
        .run(|app, event| match event {
            // This is a tray app: closing the last window (settings) must not quit it.
            // `code` is `None` for implicit exits; an explicit `app.exit()` (Quit) passes through.
            tauri::RunEvent::ExitRequested { api, code, .. } => {
                if code.is_none() {
                    api.prevent_exit();
                }
            }
            // macOS hands a double-clicked document to the running (or just started) app this way.
            #[cfg(target_os = "macos")]
            tauri::RunEvent::Opened { urls } => {
                document::open_args(app, urls.iter().map(ToString::to_string));
            }
            _ => {
                let _ = app;
            }
        });
}
