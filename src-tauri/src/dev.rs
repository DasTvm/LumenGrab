//! Debug-build helpers for native smoke tests from a terminal (compiled out of release builds).
//!
//!   LUMENGRAB_DEV_CAPTURE=fullscreen|area|window   start that capture shortly after launch
//!   LUMENGRAB_DEV_TOOLBAR=1                        show the capture bar (like the main shortcut)
//!   LUMENGRAB_DEV_AUTOSUBMIT=1                     area: select a centred 400x300 px rectangle,
//!                                                  window: take the frontmost window
//!
//!   LUMENGRAB_DEV_SELFTEST=1                       while the overlays are visible, capture every display
//!                                                  again and report whether the overlays show up in it
//!
//!   LUMENGRAB_DEV_WINDOW=settings|permission       open that window shortly after launch
//!   LUMENGRAB_DEV_HOLD=1                           keep the overlays open and print per-display window lists
//!   LUMENGRAB_DEV_HANG=1                           block the main thread (with HOLD) to test the watchdog
//!   LUMENGRAB_DEV_PROTECTED=1                      make the overlays content protected (off by default)
//!
//!   LUMENGRAB_DEV_REPEAT=n                         run the capture n times in a row in one process (re-uses the
//!                                                  warm overlay windows), then quit
//!
//! When `LUMENGRAB_DEV_CAPTURE` is set the app quits after the capture was delivered.

use std::time::Duration;

use std::sync::Arc;

use tauri::{AppHandle, Manager};

use crate::capture::{
    flow, geometry,
    store::{CaptureStore, Session},
    CaptureMode, Capturer, DisplayInfo, PxRect,
};

fn requested_mode() -> Option<CaptureMode> {
    match std::env::var("LUMENGRAB_DEV_CAPTURE").ok()?.as_str() {
        "fullscreen" => Some(CaptureMode::Fullscreen),
        "area" => Some(CaptureMode::Area),
        "window" => Some(CaptureMode::Window),
        _ => None,
    }
}

pub fn autostart(app: &AppHandle) {
    if let Ok(which) = std::env::var("LUMENGRAB_DEV_WINDOW") {
        let app = app.clone();
        std::thread::spawn(move || {
            std::thread::sleep(Duration::from_millis(1200));
            match which.as_str() {
                "settings" => crate::tray::show_settings(&app),
                "permission" => crate::permission::show(&app),
                other => eprintln!("[lumengrab:dev] unknown LUMENGRAB_DEV_WINDOW {other}"),
            }
        });
    }
    let Some(mode) = requested_mode() else { return };
    let app = app.clone();
    std::thread::spawn(move || {
        std::thread::sleep(Duration::from_millis(1500));
        eprintln!("[lumengrab:dev] starting {mode:?} capture");
        flow::start(&app, mode, std::env::var("LUMENGRAB_DEV_TOOLBAR").is_ok());
    });
}

/// Called when the overlay under the cursor is visible.
pub fn autosubmit(app: &AppHandle, session: &Session, display: &DisplayInfo) {
    let submit = std::env::var("LUMENGRAB_DEV_AUTOSUBMIT").is_ok();
    // LUMENGRAB_DEV_HOLD=1: keep the overlays open (print the window lists, never submit).
    if requested_mode().is_none() || !(submit || std::env::var("LUMENGRAB_DEV_HOLD").is_ok()) {
        return;
    }
    let (app, id, display, mode) = (
        app.clone(),
        session.id.clone(),
        display.clone(),
        session.live_mode(),
    );
    let first_window = geometry::windows_on_display(&display, &session.windows)
        .first()
        .map(|(id, _)| *id);
    let session_displays_info: Vec<DisplayInfo> =
        session.displays.iter().map(|d| d.info.clone()).collect();
    let session_windows = session.windows.clone();
    let frozen: Vec<(u32, f64)> = session
        .displays
        .iter()
        .map(|d| (d.info.id, mean_luma(&d.frame.rgba)))
        .collect();
    std::thread::spawn(move || {
        std::thread::sleep(Duration::from_millis(500));
        if std::env::var("LUMENGRAB_DEV_SELFTEST").is_ok() {
            for d in &session_displays_info {
                let list = geometry::windows_on_display(d, &session_windows);
                eprintln!(
                    "[lumengrab:dev] display {} offers {} selectable windows: {:?}",
                    d.id,
                    list.len(),
                    list.iter()
                        .map(|(id, r)| (*id, r.x, r.y, r.width, r.height))
                        .collect::<Vec<_>>()
                );
            }
            for (label, w) in app.webview_windows() {
                if label.starts_with("overlay-") {
                    eprintln!(
                        "[lumengrab:dev] {label}: visible={:?} pos={:?} size={:?} scale={:?} always_on_top={:?} focused={:?}",
                        w.is_visible(), w.outer_position(), w.outer_size(), w.scale_factor(), w.is_always_on_top(), w.is_focused()
                    );
                }
            }
            // Independent reference: the system screenshot tool, all displays.
            let _ = std::process::Command::new("/usr/sbin/screencapture")
                .args([
                    "-x",
                    "/tmp/lg-selftest-cli-1.png",
                    "/tmp/lg-selftest-cli-2.png",
                ])
                .status();
            let capturer = app.state::<Arc<dyn Capturer>>().inner().clone();
            for (display_id, before) in &frozen {
                match capturer.capture_display(*display_id) {
                    Ok(frame) => {
                        let after = mean_luma(&frame.rgba);
                        if let Ok(png) = crate::capture::encode::encode_png(
                            &frame,
                            crate::capture::encode::Profile::Fast,
                        ) {
                            let _ = std::fs::write(
                                format!("/tmp/lg-selftest-sck-{display_id}.png"),
                                png,
                            );
                        }
                        eprintln!(
                            "[lumengrab:dev] selftest display {display_id}: mean luma frozen {before:.1}, while overlay is up {after:.1}, ratio {:.2} (a visible overlay would be about 0.55 or lower; 1.0 = overlay excluded from capture)",
                            after / before
                        );
                    }
                    Err(e) => {
                        eprintln!("[lumengrab:dev] selftest display {display_id} failed: {e}")
                    }
                }
            }
        }
        if std::env::var("LUMENGRAB_DEV_HANG").is_ok() {
            // Simulates a frozen main thread while overlays are up: the watchdog must end the process.
            eprintln!("[lumengrab:dev] blocking the main thread for 60 s on purpose");
            let _ = app.run_on_main_thread(|| std::thread::sleep(Duration::from_secs(60)));
        }
        if !submit {
            return;
        }
        let result = match (mode, first_window) {
            (CaptureMode::Window, Some(window)) => flow::submit_window(&app, &id, window),
            _ => {
                let (w, h) = (400.min(display.pixel_width), 300.min(display.pixel_height));
                let rect = PxRect {
                    x: (display.pixel_width - w) / 2,
                    y: (display.pixel_height - h) / 2,
                    width: w,
                    height: h,
                };
                flow::submit_area(&app, &id, display.id, rect)
            }
        };
        eprintln!("[lumengrab:dev] auto-submit -> {result:?}");
    });
}

pub fn after_deliver(app: &AppHandle, problems: &[String]) {
    if requested_mode().is_none() {
        return;
    }
    eprintln!("[lumengrab:dev] delivered, problems: {problems:?}");
    let app = app.clone();
    std::thread::spawn(move || {
        std::thread::sleep(Duration::from_millis(500));
        static DONE: std::sync::atomic::AtomicU32 = std::sync::atomic::AtomicU32::new(1);
        let wanted: u32 = std::env::var("LUMENGRAB_DEV_REPEAT")
            .ok()
            .and_then(|n| n.parse().ok())
            .unwrap_or(1);
        let done = DONE.fetch_add(1, std::sync::atomic::Ordering::SeqCst);
        if done < wanted {
            if let Some(mode) = requested_mode() {
                eprintln!("[lumengrab:dev] --- repeat {} of {wanted}", done + 1);
                flow::start(&app, mode, std::env::var("LUMENGRAB_DEV_TOOLBAR").is_ok());
                return;
            }
        }
        let _ = tauri::Manager::state::<CaptureStore>(&app); // keep the import used in all cfgs
        app.exit(0);
    });
}

/// Mean luma of an RGBA buffer, sampled (every 97th pixel is plenty).
fn mean_luma(rgba: &[u8]) -> f64 {
    let (mut sum, mut n) = (0.0_f64, 0.0_f64);
    for px in rgba.as_chunks::<4>().0.iter().step_by(97) {
        sum += 0.2126 * f64::from(px[0]) + 0.7152 * f64::from(px[1]) + 0.0722 * f64::from(px[2]);
        n += 1.0;
    }
    sum / n.max(1.0)
}
