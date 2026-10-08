//! The capture state machine. Thin on purpose: it only sequences OS-only steps (freeze displays,
//! open overlays, crop, save). Everything about how the overlay looks and feels is TypeScript.
//!
//!   hotkey/tray ─► start ─► permission? ─► fullscreen: capture display under cursor ─► deliver
//!                                      └► area/window: freeze all displays ─► overlays ─► submit/cancel
//!
//! Displays are frozen **before** the overlays exist, so overlays can never appear in a capture.

use std::{sync::Arc, time::Instant};

use tauri::{AppHandle, Manager};

use super::{
    geometry, guard, output, overlay,
    store::{CaptureStore, Session, SessionDisplay},
    CaptureError, CaptureMode, CaptureResult, Capturer, Frame, PxRect,
};
use crate::{hotkeys, platform};

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
    let started = Instant::now();
    let stage = |name: &str| {
        eprintln!(
            "[lumengrab] +{:>4} ms {name}",
            started.elapsed().as_millis()
        )
    };
    let capturer = capturer(app);
    if !capturer.permission_granted() && !capturer.request_permission() {
        return Err(CaptureError::PermissionDenied);
    }
    stage("permission checked");
    let displays = capturer.displays()?;
    stage("displays listed");
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

    // Freeze every display (and list windows) while the hidden overlay windows are being created, so
    // the window creation time is hidden. Hidden windows are never part of a capture.
    let store = app.state::<CaptureStore>();
    let id = store.reserve();
    hotkeys::grab_escape(app);
    guard::spawn(app, &id);
    let (frozen, windows, opened) = std::thread::scope(|s| {
        let open = s.spawn(|| overlay::open_all(app, &id, mode, &displays));
        let windows = s.spawn(|| {
            if mode == CaptureMode::Window {
                capturer.windows()
            } else {
                Ok(Vec::new())
            }
        });
        let handles: Vec<_> = displays
            .iter()
            .map(|d| s.spawn(|| capturer.capture_display(d.id)))
            .collect();
        let frames: Vec<CaptureResult<Frame>> = handles
            .into_iter()
            .map(|h| {
                h.join()
                    .unwrap_or_else(|_| Err(CaptureError::Backend("capture thread crashed".into())))
            })
            .collect();
        (
            frames,
            windows
                .join()
                .unwrap_or_else(|_| Err(CaptureError::Backend("window list crashed".into()))),
            open.join()
                .unwrap_or_else(|_| Err(tauri::Error::FailedToReceiveMessage)),
        )
    });
    stage("displays frozen, overlays created");

    let built = (|| -> CaptureResult<Session> {
        let mut session_displays = Vec::new();
        for (info, frame) in displays.iter().zip(frozen) {
            session_displays.push(SessionDisplay::new(info.clone(), frame?));
        }
        opened.map_err(|e| {
            CaptureError::Backend(format!("could not open the capture overlay: {e}"))
        })?;
        Ok(Session {
            id: id.clone(),
            started,
            mode,
            displays: session_displays,
            windows: windows?,
        })
    })();
    let session = match built {
        Ok(session) => session,
        Err(e) => {
            finish(app, &id);
            return Err(e);
        }
    };

    // Encode the frames for the overlays (in parallel) before publishing, so they load instantly.
    std::thread::scope(|s| {
        for d in &session.displays {
            s.spawn(|| d.png());
        }
    });
    stage("frames encoded");
    store.publish(session);
    Ok(Started::Overlays)
}

/// Ends a session (idempotent) and closes its overlays.
pub fn finish(app: &AppHandle, session_id: &str) {
    eprintln!("[lumengrab] capture {session_id} ended");
    hotkeys::release_escape(app);
    app.state::<CaptureStore>().finish(Some(session_id));
    overlay::close_all(app, session_id);
}

/// Cancels whatever capture is in progress (global Esc).
pub fn cancel_active(app: &AppHandle) {
    if let Some(id) = app.state::<CaptureStore>().active_id() {
        finish(app, &id);
    }
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
