//! Safety nets that run for as long as capture overlays are up.
//!
//! The overlays are borderless windows above everything else. If the app froze while they are up,
//! the whole screen would be unusable (this happened in the first test build). So two small
//! threads, which never depend on the main thread, watch over every capture:
//! - **watchdog**: pings the main thread twice a second. If it does not answer for
//!   `MAIN_THREAD_TIMEOUT`, the process exits, which removes the overlays. A capture is also
//!   cancelled after `MAX_CAPTURE` so a forgotten overlay cannot stay forever.
//! - **cursor follower**: gives keyboard and mouse focus to the overlay on the display the cursor is
//!   on. A window that is not key does not receive hover events, which made window picking dead on
//!   every display except the first.

use std::{
    sync::mpsc::channel,
    time::{Duration, Instant},
};

use tauri::{AppHandle, Manager};

use super::{flow, geometry, overlay, store::CaptureStore};
use crate::platform;

const POLL: Duration = Duration::from_millis(500);
const MAIN_THREAD_TIMEOUT: Duration = Duration::from_secs(4);
const MAX_CAPTURE: Duration = Duration::from_secs(10 * 60);
const FOLLOW_INTERVAL: Duration = Duration::from_millis(40);

pub fn spawn(app: &AppHandle, session_id: &str) {
    let (watch_app, watch_id) = (app.clone(), session_id.to_owned());
    std::thread::spawn(move || watchdog(&watch_app, &watch_id));
    let (follow_app, follow_id) = (app.clone(), session_id.to_owned());
    std::thread::spawn(move || follow_cursor(&follow_app, &follow_id));
}

fn is_active(app: &AppHandle, id: &str) -> bool {
    app.state::<CaptureStore>().active_id().as_deref() == Some(id)
}

fn watchdog(app: &AppHandle, id: &str) {
    let started = Instant::now();
    while is_active(app, id) {
        std::thread::sleep(POLL);
        if started.elapsed() > MAX_CAPTURE {
            flow::finish(app, id);
            return;
        }
        let (tx, rx) = channel();
        if app
            .run_on_main_thread(move || {
                let _ = tx.send(());
            })
            .is_err()
        {
            return; // the event loop is gone: the app is quitting
        }
        if rx.recv_timeout(MAIN_THREAD_TIMEOUT).is_err() && is_active(app, id) {
            eprintln!("[lumengrab] main thread unresponsive during a capture: exiting so the overlays disappear");
            std::process::exit(70);
        }
    }
}

fn follow_cursor(app: &AppHandle, id: &str) {
    let mut last: Option<u32> = None;
    while is_active(app, id) {
        std::thread::sleep(FOLLOW_INTERVAL);
        let Some(session) = app.state::<CaptureStore>().get(id) else {
            continue; // still freezing the displays
        };
        let Some((x, y)) = platform::cursor_position(app) else {
            continue;
        };
        let displays: Vec<_> = session.displays.iter().map(|d| d.info.clone()).collect();
        let Some(display) = geometry::display_at_point(&displays, x, y) else {
            continue;
        };
        if last != Some(display.id) {
            last = Some(display.id);
            overlay::focus(app, id, display.id);
            #[cfg(any(debug_assertions, feature = "dev-hooks"))]
            {
                std::thread::sleep(Duration::from_millis(150));
                let key: Vec<String> = app
                    .webview_windows()
                    .into_iter()
                    .filter(|(_, w)| w.is_focused().unwrap_or(false))
                    .map(|(label, _)| label)
                    .collect();
                eprintln!(
                    "[lumengrab:dev] cursor on display {} -> key overlay(s): {key:?}",
                    display.id
                );
            }
        }
    }
}
