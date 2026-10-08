//! macOS backend: ScreenCaptureKit stills (`SCScreenshotManager`, macOS 14+) via the
//! `screencapturekit` crate. Rules learned from the spike (docs/adr/0001-capture-backend.md):
//! - always set the output size from the filter's `pixel_size()` (the default config returns 1920x1080),
//! - read BGRA (2 ms) not RGBA (34-54 ms extra), and un-premultiply alpha ourselves,
//! - windows: ignore shadows, otherwise the window is shrunk to make room for the shadow,
//! - never include the cursor,
//! - `SCShareableContent::windows()` is not in z-order, so order comes from CGWindowList.

use std::{
    sync::{Arc, Mutex},
    time::{Duration, Instant},
};

use screencapturekit::{
    prelude::*,
    screenshot_manager::{CGImageExt, SCScreenshotManager},
    shareable_content::SCShareableContentInfo,
};

use crate::capture::{
    pixels, CaptureError, CaptureResult, Capturer, DisplayInfo, Frame, NativeRect, WindowInfo,
};
use crate::platform;

/// How long a display snapshot from `displays()` may be reused by the `capture_display` calls that
/// follow it. Fetching `SCShareableContent` costs 70-110 ms, so one fetch serves the whole freeze.
const SNAPSHOT_TTL: Duration = Duration::from_secs(3);

#[derive(Default)]
pub struct SckCapturer {
    snapshot: Mutex<Option<(Instant, Arc<SCShareableContent>)>>,
}

impl SckCapturer {
    fn fresh_displays(&self) -> CaptureResult<Arc<SCShareableContent>> {
        let content = Arc::new(content(false)?);
        *self.snapshot.lock().expect("snapshot lock") = Some((Instant::now(), content.clone()));
        Ok(content)
    }

    fn recent_displays(&self) -> CaptureResult<Arc<SCShareableContent>> {
        if let Some((at, content)) = self.snapshot.lock().expect("snapshot lock").as_ref() {
            if at.elapsed() < SNAPSHOT_TTL {
                return Ok(content.clone());
            }
        }
        self.fresh_displays()
    }
}

/// Windows smaller than this are never worth selecting (tooltips, handles, helper windows).
const MIN_WINDOW_POINTS: (f64, f64) = (100.0, 50.0);

fn backend_err(e: impl std::fmt::Display) -> CaptureError {
    CaptureError::Backend(e.to_string())
}

/// Without permission ScreenCaptureKit errors; that is the permission signal we surface.
fn content(on_screen_windows: bool) -> CaptureResult<SCShareableContent> {
    if !platform::has_screen_access() {
        return Err(CaptureError::PermissionDenied);
    }
    SCShareableContent::create()
        .with_on_screen_windows_only(on_screen_windows)
        .with_exclude_desktop_windows(true)
        .get()
        .map_err(backend_err)
}

fn grab(
    filter: &SCContentFilter,
    config: &SCStreamConfiguration,
    opaque: bool,
) -> CaptureResult<Frame> {
    let image = SCScreenshotManager::capture_image(filter, config).map_err(backend_err)?;
    let (width, height) = (image.width() as u32, image.height() as u32);
    let mut rgba = image.bgra_data().map_err(backend_err)?;
    if width == 0 || height == 0 || rgba.len() != width as usize * height as usize * 4 {
        return Err(backend_err(format!(
            "unexpected pixel buffer: {} bytes for {width}x{height}",
            rgba.len()
        )));
    }
    if opaque {
        pixels::bgra_opaque_to_rgba(&mut rgba);
    } else {
        pixels::bgra_premultiplied_to_rgba(&mut rgba);
    }
    Ok(Frame {
        width,
        height,
        rgba,
    })
}

fn rect(r: CGRect) -> NativeRect {
    NativeRect {
        x: r.origin.x,
        y: r.origin.y,
        width: r.size.width,
        height: r.size.height,
    }
}

impl Capturer for SckCapturer {
    fn permission_granted(&self) -> bool {
        platform::has_screen_access()
    }

    fn request_permission(&self) -> bool {
        platform::request_screen_access()
    }

    fn displays(&self) -> CaptureResult<Vec<DisplayInfo>> {
        let content = self.fresh_displays()?;
        let mut out = Vec::new();
        for d in content.displays() {
            let filter = SCContentFilter::create()
                .with_display(&d)
                .with_excluding_windows(&[])
                .build()
                .map_err(backend_err)?;
            let info = SCShareableContentInfo::for_filter(&filter)
                .ok_or_else(|| backend_err("no content info"))?;
            let (pixel_width, pixel_height) = info.pixel_size();
            let native = rect(d.frame());
            out.push(DisplayInfo {
                id: d.display_id(),
                name: format!("Display {}", d.display_id()),
                native,
                pixel_width,
                pixel_height,
                scale: f64::from(info.point_pixel_scale()),
                is_primary: native.x == 0.0 && native.y == 0.0,
            });
        }
        Ok(out)
    }

    fn windows(&self) -> CaptureResult<Vec<WindowInfo>> {
        let content = content(true)?;
        let own_pid = std::process::id() as i32;
        let mut by_id: Vec<WindowInfo> = content
            .windows()
            .into_iter()
            .filter_map(|w| {
                let f = w.frame();
                let app = w.owning_application();
                let title = w.title().unwrap_or_default();
                let real = w.is_on_screen()
                    && w.window_layer() == 0
                    && f.size.width >= MIN_WINDOW_POINTS.0
                    && f.size.height >= MIN_WINDOW_POINTS.1
                    && !title.is_empty()
                    && app.as_ref().is_none_or(|a| a.process_id() != own_pid);
                real.then(|| WindowInfo {
                    id: w.window_id(),
                    title,
                    app_name: app.map(|a| a.application_name()).unwrap_or_default(),
                    native: rect(f),
                })
            })
            .collect();
        // Front to back, using CGWindowList order. Windows missing from it are not on screen.
        let order = platform::window_ids_front_to_back();
        by_id.retain(|w| order.contains(&w.id));
        by_id.sort_by_key(|w| order.iter().position(|id| *id == w.id));
        Ok(by_id)
    }

    fn capture_display(&self, display_id: u32) -> CaptureResult<Frame> {
        let content = self.recent_displays()?;
        let display = content
            .displays()
            .into_iter()
            .find(|d| d.display_id() == display_id)
            .ok_or_else(|| CaptureError::NotFound("The display".into()))?;
        let filter = SCContentFilter::create()
            .with_display(&display)
            .with_excluding_windows(&[])
            .build()
            .map_err(backend_err)?;
        let (w, h) = SCShareableContentInfo::for_filter(&filter)
            .ok_or_else(|| backend_err("no content info"))?
            .pixel_size();
        let config = SCStreamConfiguration::new()
            .with_width(w)
            .with_height(h)
            .with_shows_cursor(false);
        grab(&filter, &config, true)
    }

    fn capture_window(&self, window_id: u32) -> CaptureResult<Frame> {
        let content = content(true)?;
        let window = content
            .windows()
            .into_iter()
            .find(|w| w.window_id() == window_id)
            .ok_or_else(|| CaptureError::NotFound("The window".into()))?;
        let filter = SCContentFilter::create()
            .with_window(&window)
            .build()
            .map_err(backend_err)?;
        let (w, h) = SCShareableContentInfo::for_filter(&filter)
            .ok_or_else(|| backend_err("no content info"))?
            .pixel_size();
        let config = SCStreamConfiguration::new()
            .with_width(w)
            .with_height(h)
            .with_shows_cursor(false)
            .with_ignores_shadows_single_window(true)
            .map_err(backend_err)?;
        grab(&filter, &config, false)
    }
}
