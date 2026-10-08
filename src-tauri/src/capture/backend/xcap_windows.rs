//! Windows backend: `xcap`. Windows.Graphics.Capture by default (cursor and border off, no GDI
//! blank-frame reports); without the `wgc` feature it falls back to GDI.
//!
//! Everything xcap reports on Windows is in **physical pixels** (the process is per-monitor DPI
//! aware: tao sets that when the event loop starts), so native units == pixels here.
//! Written without Windows hardware at hand: the Windows CI job compiles and unit-tests it, and the
//! spike reports from real machines confirm the assumptions (docs/adr/0001-capture-backend.md).

use xcap::{Monitor, Window};

use crate::capture::{
    CaptureError, CaptureResult, Capturer, DisplayInfo, Frame, NativeRect, WindowInfo,
};

pub struct XcapCapturer;

/// Windows smaller than this (physical pixels) are never worth selecting.
const MIN_WINDOW_PX: (u32, u32) = (100, 50);

fn backend_err(e: impl std::fmt::Display) -> CaptureError {
    CaptureError::Backend(e.to_string())
}

/// GDI hands out alpha 0; WGC window captures keep their real alpha (rounded corners).
const FORCE_OPAQUE_WINDOWS: bool = !cfg!(feature = "wgc");

fn frame(width: u32, height: u32, mut rgba: Vec<u8>, force_opaque: bool) -> Frame {
    if force_opaque {
        rgba.chunks_exact_mut(4).for_each(|px| px[3] = 255);
    }
    Frame {
        width,
        height,
        rgba,
    }
}

impl Capturer for XcapCapturer {
    fn permission_granted(&self) -> bool {
        true
    }

    fn request_permission(&self) -> bool {
        true
    }

    fn displays(&self) -> CaptureResult<Vec<DisplayInfo>> {
        let monitors = Monitor::all().map_err(backend_err)?;
        monitors
            .iter()
            .map(|m| {
                let (width, height) = (
                    m.width().map_err(backend_err)?,
                    m.height().map_err(backend_err)?,
                );
                Ok(DisplayInfo {
                    id: m.id().map_err(backend_err)?,
                    name: m.friendly_name().unwrap_or_default(),
                    native: NativeRect {
                        x: f64::from(m.x().map_err(backend_err)?),
                        y: f64::from(m.y().map_err(backend_err)?),
                        width: f64::from(width),
                        height: f64::from(height),
                    },
                    pixel_width: width,
                    pixel_height: height,
                    scale: f64::from(m.scale_factor().unwrap_or(1.0)),
                    is_primary: m.is_primary().unwrap_or(false),
                })
            })
            .collect()
    }

    fn windows(&self) -> CaptureResult<Vec<WindowInfo>> {
        let own_pid = std::process::id();
        // xcap lists top-level windows with EnumWindows: already front to back.
        let all = Window::all().map_err(backend_err)?;
        Ok(all
            .iter()
            .filter_map(|w| {
                let (width, height) = (w.width().ok()?, w.height().ok()?);
                let title = w.title().unwrap_or_default();
                let real = !w.is_minimized().unwrap_or(true)
                    && width >= MIN_WINDOW_PX.0
                    && height >= MIN_WINDOW_PX.1
                    && !title.is_empty()
                    && w.pid().ok()? != own_pid;
                real.then(|| WindowInfo {
                    id: w.id().unwrap_or(0),
                    title,
                    app_name: w.app_name().unwrap_or_default(),
                    native: NativeRect {
                        x: f64::from(w.x().unwrap_or(0)),
                        y: f64::from(w.y().unwrap_or(0)),
                        width: f64::from(width),
                        height: f64::from(height),
                    },
                })
            })
            .collect())
    }

    fn capture_display(&self, display_id: u32) -> CaptureResult<Frame> {
        let monitor = Monitor::all()
            .map_err(backend_err)?
            .into_iter()
            .find(|m| m.id().ok() == Some(display_id))
            .ok_or_else(|| CaptureError::NotFound("The display".into()))?;
        let img = monitor.capture_image().map_err(backend_err)?;
        let (w, h) = (img.width(), img.height());
        // A display is always opaque.
        Ok(frame(w, h, img.into_raw(), true))
    }

    fn capture_window(&self, window_id: u32) -> CaptureResult<Frame> {
        let window = Window::all()
            .map_err(backend_err)?
            .into_iter()
            .find(|w| w.id().ok() == Some(window_id))
            .ok_or_else(|| CaptureError::NotFound("The window".into()))?;
        let img = window.capture_image().map_err(backend_err)?;
        let (w, h) = (img.width(), img.height());
        Ok(frame(w, h, img.into_raw(), FORCE_OPAQUE_WINDOWS))
    }
}
