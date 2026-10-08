//! LumenGrab native shell. Kept thin on purpose: product logic lives in TypeScript.

mod capture;
#[cfg(any(debug_assertions, feature = "dev-hooks"))]
mod dev;
mod hotkeys;
mod platform;
mod tray;

use std::{borrow::Cow, sync::Arc};

use tauri::{Manager, WindowEvent};

use capture::{backend, commands, overlay, store::CaptureStore, Capturer};

pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_clipboard_manager::init())
        .plugin(hotkeys::plugin())
        .manage(CaptureStore::default())
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
            commands::capture_submit_area,
            commands::capture_submit_window,
            commands::capture_cancel,
        ])
        .on_window_event(|window, event| {
            // An overlay closed by the OS or the user must not leave the capture stuck "busy".
            if let (WindowEvent::Destroyed, Some(session)) =
                (event, overlay::session_of_label(window.label()))
            {
                capture::flow::finish(window.app_handle(), session);
            }
        })
        .setup(|app| {
            platform::setup_app(app);
            tray::init(app.handle())?;
            hotkeys::register(app.handle());
            #[cfg(any(debug_assertions, feature = "dev-hooks"))]
            dev::autostart(app.handle());
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
