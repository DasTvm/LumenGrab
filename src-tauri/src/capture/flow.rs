//! The capture state machine. Thin on purpose: it only sequences OS-only steps (freeze displays,
//! open overlays, crop, save). Everything about how the overlay looks and feels is TypeScript.
//!
//!   hotkey/tray ─► start ─► permission? ─► fullscreen: capture display under cursor ─► deliver
//!                                      └► area/window: freeze all displays ─► overlays ─► submit/cancel
//!
//! Displays are frozen **before** the overlays exist, so overlays can never appear in a capture.

use std::sync::Arc;

use tauri::{AppHandle, Manager};

use super::{
    geometry, output, overlay,
    store::{CaptureStore, Session, SessionDisplay},
    CaptureError, CaptureMode, CaptureResult, Capturer, Frame, PxRect,
};
use crate::platform;

fn capturer(app: &AppHandle) -> Arc<dyn Capturer> {
    app.state::<Arc<dyn Capturer>>().inner().clone()
}

/// Entry point for hotkeys, the tray and the `capture_start` command. Returns immediately.
pub fn start(app: &AppHandle, mode: CaptureMode) {
    let app = app.clone();
    std::thread::spawn(move || {
        let store = app.state::<CaptureStore>();
        if !store.try_begin() {
            return; // key repeat or a second press while a capture is running
        }
        match run(&app, mode) {
            Ok(Started::Overlays) => {} // stays busy until submit or cancel
            Ok(Started::Done) => {
                store.finish(None);
            }
            Err(CaptureError::PermissionDenied) => {
                store.finish(None);
                output::permission_help(&app);
            }
            Err(e) => {
                store.finish(None);
                output::error_dialog(&app, &e.to_string());
            }
        }
    });
}

enum Started {
    Overlays,
    Done,
}

fn run(app: &AppHandle, mode: CaptureMode) -> CaptureResult<Started> {
    let capturer = capturer(app);
    if !capturer.permission_granted() && !capturer.request_permission() {
        return Err(CaptureError::PermissionDenied);
    }
    let displays = capturer.displays()?;
    if displays.is_empty() {
        return Err(CaptureError::NotFound("Any display".into()));
    }

    if mode == CaptureMode::Fullscreen {
        let (x, y) = platform::cursor_position(app).unwrap_or((0.0, 0.0));
        let display = geometry::display_at_point(&displays, x, y)
            .ok_or_else(|| CaptureError::NotFound("The display".into()))?;
        let frame = capturer.capture_display(display.id)?;
        output::deliver(app, frame);
        return Ok(Started::Done);
    }

    // Freeze every display at the same moment, in parallel.
    let frames: Vec<CaptureResult<Frame>> = std::thread::scope(|s| {
        let handles: Vec<_> = displays
            .iter()
            .map(|d| s.spawn(|| capturer.capture_display(d.id)))
            .collect();
        handles
            .into_iter()
            .map(|h| {
                h.join()
                    .unwrap_or_else(|_| Err(CaptureError::Backend("capture thread crashed".into())))
            })
            .collect()
    });
    let mut session_displays = Vec::new();
    for (info, frame) in displays.iter().zip(frames) {
        session_displays.push(SessionDisplay::new(info.clone(), frame?));
    }
    let windows = if mode == CaptureMode::Window {
        capturer.windows()?
    } else {
        Vec::new()
    };

    // Encode the frames for the overlays now (in parallel) so the overlays can load instantly.
    std::thread::scope(|s| {
        for d in &session_displays {
            s.spawn(|| d.png());
        }
    });

    let store = app.state::<CaptureStore>();
    let session = store.publish(Session {
        id: store.next_id(),
        mode,
        displays: session_displays,
        windows,
    });
    if let Err(e) = overlay::open_all(app, &session) {
        finish(app, &session.id);
        return Err(CaptureError::Backend(format!(
            "could not open the capture overlay: {e}"
        )));
    }
    Ok(Started::Overlays)
}

/// Ends a session (idempotent) and closes its overlays.
pub fn finish(app: &AppHandle, session_id: &str) {
    app.state::<CaptureStore>().finish(Some(session_id));
    overlay::close_all(app, session_id);
}

/// The user selected an area on one display. Coordinates are physical pixels of that display's frame.
pub fn submit_area(
    app: &AppHandle,
    session_id: &str,
    display_id: u32,
    rect: PxRect,
) -> CaptureResult<()> {
    let store = app.state::<CaptureStore>();
    let session = store
        .get(session_id)
        .ok_or_else(|| CaptureError::NotFound("The capture".into()))?;
    let display = session
        .display(display_id)
        .ok_or_else(|| CaptureError::NotFound("The display".into()))?;
    let cropped = geometry::crop(&display.frame, &rect)?; // validates and clamps untrusted input
    finish(app, session_id);
    spawn_deliver(app, cropped);
    Ok(())
}

/// The user picked a window. It is captured on its own, so overlapping windows are not in the image.
pub fn submit_window(app: &AppHandle, session_id: &str, window_id: u32) -> CaptureResult<()> {
    let store = app.state::<CaptureStore>();
    let session = store
        .get(session_id)
        .ok_or_else(|| CaptureError::NotFound("The capture".into()))?;
    if !session.windows.iter().any(|w| w.id == window_id) {
        return Err(CaptureError::NotFound("The window".into()));
    }
    finish(app, session_id);
    let app = app.clone();
    std::thread::spawn(move || match capturer(&app).capture_window(window_id) {
        Ok(frame) => output::deliver(&app, frame),
        Err(e) => output::error_dialog(&app, &e.to_string()),
    });
    Ok(())
}

fn spawn_deliver(app: &AppHandle, frame: Frame) {
    let app = app.clone();
    std::thread::spawn(move || output::deliver(&app, frame));
}
