//! Pure coordinate math. No OS calls, so it is unit-tested on every platform in CI.

use std::path::{Path, PathBuf};

use super::{CaptureError, CaptureResult, DisplayInfo, Frame, NativeRect, PxRect, WindowInfo};

/// Smallest selection edge in output pixels that Rust accepts. The UI enforces a larger minimum
/// in CSS pixels; this only rejects degenerate input.
pub const MIN_SELECTION_PX: u32 = 1;

impl NativeRect {
    pub fn contains(&self, x: f64, y: f64) -> bool {
        x >= self.x && y >= self.y && x < self.x + self.width && y < self.y + self.height
    }

    /// Squared distance from a point to the rectangle (0 when inside).
    fn distance_sq(&self, x: f64, y: f64) -> f64 {
        let dx = (self.x - x).max(0.0).max(x - (self.x + self.width));
        let dy = (self.y - y).max(0.0).max(y - (self.y + self.height));
        dx * dx + dy * dy
    }
}

/// The display a native-unit point is on. A point outside every display (cursor race while a
/// monitor is unplugged) falls back to the nearest one.
pub fn display_at_point(displays: &[DisplayInfo], x: f64, y: f64) -> Option<&DisplayInfo> {
    displays
        .iter()
        .find(|d| d.native.contains(x, y))
        .or_else(|| {
            displays.iter().min_by(|a, b| {
                a.native
                    .distance_sq(x, y)
                    .total_cmp(&b.native.distance_sq(x, y))
            })
        })
}

/// Pixels per native unit on each axis, derived from the real sizes (exact, no rounding of `scale`).
fn pixels_per_unit(d: &DisplayInfo) -> (f64, f64) {
    (
        f64::from(d.pixel_width) / d.native.width,
        f64::from(d.pixel_height) / d.native.height,
    )
}

/// Maps a rectangle in native units (a window frame) to pixels relative to the display's top-left,
/// clipped to the display. `None` if nothing of it is on this display.
pub fn native_rect_to_display_px(d: &DisplayInfo, r: &NativeRect) -> Option<PxRect> {
    let (sx, sy) = pixels_per_unit(d);
    let x0 = ((r.x - d.native.x) * sx).round().max(0.0);
    let y0 = ((r.y - d.native.y) * sy).round().max(0.0);
    let x1 = ((r.x + r.width - d.native.x) * sx)
        .round()
        .min(f64::from(d.pixel_width));
    let y1 = ((r.y + r.height - d.native.y) * sy)
        .round()
        .min(f64::from(d.pixel_height));
    if x1 <= x0 || y1 <= y0 {
        return None;
    }
    Some(PxRect {
        x: x0 as u32,
        y: y0 as u32,
        width: (x1 - x0) as u32,
        height: (y1 - y0) as u32,
    })
}

/// Windows (front to back) that are visible on `d`, as display-local pixel rectangles.
pub fn windows_on_display(d: &DisplayInfo, windows: &[WindowInfo]) -> Vec<(u32, PxRect)> {
    windows
        .iter()
        .filter_map(|w| native_rect_to_display_px(d, &w.native).map(|r| (w.id, r)))
        .collect()
}

/// Validates a selection coming from the UI (untrusted) against the frame it applies to, and clamps
/// it to the frame bounds. Rejects empty or absurd input.
pub fn clamp_selection(sel: &PxRect, frame_w: u32, frame_h: u32) -> CaptureResult<PxRect> {
    if sel.x >= frame_w || sel.y >= frame_h {
        return Err(CaptureError::InvalidSelection("outside the display".into()));
    }
    let width = sel.width.min(frame_w - sel.x);
    let height = sel.height.min(frame_h - sel.y);
    if width < MIN_SELECTION_PX || height < MIN_SELECTION_PX {
        return Err(CaptureError::InvalidSelection("too small".into()));
    }
    Ok(PxRect {
        x: sel.x,
        y: sel.y,
        width,
        height,
    })
}

/// Copies a rectangle out of a frame. The rectangle must already be clamped.
pub fn crop(frame: &Frame, r: &PxRect) -> CaptureResult<Frame> {
    let r = clamp_selection(r, frame.width, frame.height)?;
    let stride = frame.width as usize * 4;
    let row_bytes = r.width as usize * 4;
    let mut rgba = Vec::with_capacity(row_bytes * r.height as usize);
    for row in r.y as usize..(r.y + r.height) as usize {
        let start = row * stride + r.x as usize * 4;
        rgba.extend_from_slice(&frame.rgba[start..start + row_bytes]);
    }
    Ok(Frame {
        width: r.width,
        height: r.height,
        rgba,
    })
}

/// `LumenGrab 2026-10-08 at 15.27.19.png`. Dots instead of colons: valid on Windows too.
pub fn file_name(y: i32, mo: u32, d: u32, h: u32, mi: u32, s: u32) -> String {
    format!("LumenGrab {y:04}-{mo:02}-{d:02} at {h:02}.{mi:02}.{s:02}.png")
}

/// First free path for `name` in `dir`: `name.png`, `name (2).png`, `name (3).png` ...
pub fn unique_path(dir: &Path, name: &str, exists: impl Fn(&Path) -> bool) -> PathBuf {
    let first = dir.join(name);
    if !exists(&first) {
        return first;
    }
    let (stem, ext) = match name.rsplit_once('.') {
        Some((s, e)) => (s, format!(".{e}")),
        None => (name, String::new()),
    };
    (2u32..)
        .map(|n| dir.join(format!("{stem} ({n}){ext}")))
        .find(|p| !exists(p))
        .expect("an unbounded counter always finds a free name")
}

#[cfg(test)]
mod tests {
    use super::*;

    fn display(id: u32, x: f64, y: f64, w: f64, h: f64, scale: f64) -> DisplayInfo {
        DisplayInfo {
            id,
            name: format!("d{id}"),
            native: NativeRect {
                x,
                y,
                width: w,
                height: h,
            },
            pixel_width: (w * scale).round() as u32,
            pixel_height: (h * scale).round() as u32,
            scale,
            is_primary: x == 0.0 && y == 0.0,
        }
    }

    fn win(id: u32, x: f64, y: f64, w: f64, h: f64) -> WindowInfo {
        WindowInfo {
            id,
            title: String::new(),
            app_name: String::new(),
            native: NativeRect {
                x,
                y,
                width: w,
                height: h,
            },
        }
    }

    // The dev Mac: built-in 1920x1243 pt @2x and an external 2560x1440 pt @2x to the left, y offset.
    fn mac_layout() -> Vec<DisplayInfo> {
        vec![
            display(1, 0.0, 0.0, 1920.0, 1243.0, 2.0),
            display(2, -2560.0, -197.0, 2560.0, 1440.0, 2.0),
        ]
    }

    // Windows, physical px: 150% laptop (2880x1800 native) left of a 100% 1920x1080 monitor.
    fn win_layout() -> Vec<DisplayInfo> {
        vec![
            display(10, 0.0, 0.0, 2880.0, 1800.0, 1.0),
            display(11, 2880.0, 120.0, 1920.0, 1080.0, 1.0),
        ]
    }

    #[test]
    fn cursor_maps_to_display_including_negative_origin() {
        let l = mac_layout();
        assert_eq!(display_at_point(&l, 10.0, 10.0).unwrap().id, 1);
        assert_eq!(display_at_point(&l, -100.0, 0.0).unwrap().id, 2);
        assert_eq!(display_at_point(&l, -2560.0, -197.0).unwrap().id, 2); // exact top-left corner
        assert_eq!(display_at_point(&l, -0.5, 10.0).unwrap().id, 2); // 1 unit left of display 1
    }

    #[test]
    fn point_outside_all_displays_snaps_to_nearest() {
        let l = win_layout();
        // (2900, 50): 20 right of monitor 10's edge but 70 above monitor 11 -> monitor 10 is nearer.
        assert_eq!(display_at_point(&l, 2900.0, 50.0).unwrap().id, 10);
        // (3000, 100): 20 above monitor 11, 120 right of monitor 10 -> monitor 11.
        assert_eq!(display_at_point(&l, 3000.0, 100.0).unwrap().id, 11);
        assert_eq!(display_at_point(&l, -50.0, 10.0).unwrap().id, 10);
        assert_eq!(display_at_point(&l, 9999.0, 9999.0).unwrap().id, 11);
        assert!(display_at_point(&[], 0.0, 0.0).is_none());
    }

    #[test]
    fn window_frame_scales_to_pixels_on_hidpi() {
        let d = &mac_layout()[1];
        // A window at the external display's top-left, 1000x500 points.
        let r = native_rect_to_display_px(
            d,
            &NativeRect {
                x: -2560.0,
                y: -197.0,
                width: 1000.0,
                height: 500.0,
            },
        )
        .unwrap();
        assert_eq!(
            r,
            PxRect {
                x: 0,
                y: 0,
                width: 2000,
                height: 1000
            }
        );
        // Offset window.
        let r = native_rect_to_display_px(
            d,
            &NativeRect {
                x: -2460.0,
                y: -97.0,
                width: 100.0,
                height: 50.0,
            },
        )
        .unwrap();
        assert_eq!(
            r,
            PxRect {
                x: 200,
                y: 200,
                width: 200,
                height: 100
            }
        );
    }

    #[test]
    fn window_frame_is_identity_on_windows_units() {
        let d = &win_layout()[1];
        let r = native_rect_to_display_px(
            d,
            &NativeRect {
                x: 2980.0,
                y: 220.0,
                width: 800.0,
                height: 600.0,
            },
        )
        .unwrap();
        assert_eq!(
            r,
            PxRect {
                x: 100,
                y: 100,
                width: 800,
                height: 600
            }
        );
    }

    #[test]
    fn fractional_scale_uses_real_pixel_size() {
        // 125%: native 1536x864 units -> 1920x1080 px (ratio 1.25 exactly).
        let d = DisplayInfo {
            pixel_width: 1920,
            pixel_height: 1080,
            ..display(1, 0.0, 0.0, 1536.0, 864.0, 1.25)
        };
        let r = native_rect_to_display_px(
            &d,
            &NativeRect {
                x: 0.0,
                y: 0.0,
                width: 1536.0,
                height: 864.0,
            },
        )
        .unwrap();
        assert_eq!(
            r,
            PxRect {
                x: 0,
                y: 0,
                width: 1920,
                height: 1080
            }
        );
    }

    #[test]
    fn window_is_clipped_to_display_and_dropped_when_elsewhere() {
        let l = win_layout();
        // Straddles the seam at x=2880: 100 px on monitor 10, 300 px on monitor 11.
        let w = NativeRect {
            x: 2780.0,
            y: 200.0,
            width: 400.0,
            height: 100.0,
        };
        assert_eq!(
            native_rect_to_display_px(&l[0], &w).unwrap(),
            PxRect {
                x: 2780,
                y: 200,
                width: 100,
                height: 100
            }
        );
        assert_eq!(
            native_rect_to_display_px(&l[1], &w).unwrap(),
            PxRect {
                x: 0,
                y: 80,
                width: 300,
                height: 100
            }
        );
        // Completely on the other display.
        assert!(native_rect_to_display_px(
            &l[1],
            &NativeRect {
                x: 10.0,
                y: 10.0,
                width: 50.0,
                height: 50.0
            }
        )
        .is_none());
    }

    #[test]
    fn windows_on_display_keeps_front_to_back_order() {
        let d = &win_layout()[0];
        let ws = [
            win(3, 0.0, 0.0, 100.0, 100.0),
            win(1, 50.0, 50.0, 100.0, 100.0),
            win(9, 3000.0, 300.0, 10.0, 10.0),
        ];
        let ids: Vec<u32> = windows_on_display(d, &ws)
            .iter()
            .map(|(id, _)| *id)
            .collect();
        assert_eq!(ids, vec![3, 1]);
    }

    #[test]
    fn selection_is_clamped_and_validated() {
        let ok = clamp_selection(
            &PxRect {
                x: 10,
                y: 10,
                width: 100,
                height: 50,
            },
            1000,
            800,
        )
        .unwrap();
        assert_eq!(
            ok,
            PxRect {
                x: 10,
                y: 10,
                width: 100,
                height: 50
            }
        );
        // Runs past the edge: clamped.
        let c = clamp_selection(
            &PxRect {
                x: 900,
                y: 700,
                width: 500,
                height: 500,
            },
            1000,
            800,
        )
        .unwrap();
        assert_eq!(
            c,
            PxRect {
                x: 900,
                y: 700,
                width: 100,
                height: 100
            }
        );
        // Absurd values do not overflow.
        let c = clamp_selection(
            &PxRect {
                x: 1,
                y: 1,
                width: u32::MAX,
                height: u32::MAX,
            },
            1000,
            800,
        )
        .unwrap();
        assert_eq!((c.width, c.height), (999, 799));
        // Rejected.
        assert!(clamp_selection(
            &PxRect {
                x: 1000,
                y: 0,
                width: 10,
                height: 10
            },
            1000,
            800
        )
        .is_err());
        assert!(clamp_selection(
            &PxRect {
                x: 0,
                y: 800,
                width: 10,
                height: 10
            },
            1000,
            800
        )
        .is_err());
        assert!(clamp_selection(
            &PxRect {
                x: 0,
                y: 0,
                width: 0,
                height: 10
            },
            1000,
            800
        )
        .is_err());
        assert!(clamp_selection(
            &PxRect {
                x: 0,
                y: 0,
                width: 10,
                height: 0
            },
            1000,
            800
        )
        .is_err());
    }

    #[test]
    fn crop_copies_exactly_the_requested_pixels() {
        // 4x3 frame where every pixel's R channel is its linear index.
        let mut rgba = Vec::new();
        for i in 0..12u8 {
            rgba.extend_from_slice(&[i, 0, 0, 255]);
        }
        let f = Frame {
            width: 4,
            height: 3,
            rgba,
        };
        let c = crop(
            &f,
            &PxRect {
                x: 1,
                y: 1,
                width: 2,
                height: 2,
            },
        )
        .unwrap();
        assert_eq!((c.width, c.height), (2, 2));
        let reds: Vec<u8> = c.rgba.chunks(4).map(|p| p[0]).collect();
        assert_eq!(reds, vec![5, 6, 9, 10]);
        // Edge rows and columns: last column of the last row.
        let c = crop(
            &f,
            &PxRect {
                x: 3,
                y: 2,
                width: 1,
                height: 1,
            },
        )
        .unwrap();
        assert_eq!(c.rgba, vec![11, 0, 0, 255]);
        assert!(crop(
            &f,
            &PxRect {
                x: 4,
                y: 0,
                width: 1,
                height: 1
            }
        )
        .is_err());
    }

    #[test]
    fn file_name_is_windows_safe() {
        let n = file_name(2026, 10, 8, 15, 7, 9);
        assert_eq!(n, "LumenGrab 2026-10-08 at 15.07.09.png");
        assert!(!n.contains(':') && !n.contains('/') && !n.contains('\\'));
    }

    #[test]
    fn unique_path_appends_counter() {
        let dir = Path::new("/p");
        let taken: Vec<PathBuf> = vec![dir.join("a.png"), dir.join("a (2).png")];
        let p = unique_path(dir, "a.png", |q| taken.contains(&q.to_path_buf()));
        assert_eq!(p, dir.join("a (3).png"));
        assert_eq!(unique_path(dir, "b.png", |_| false), dir.join("b.png"));
        assert_eq!(
            unique_path(dir, "noext", |q| q == dir.join("noext")),
            dir.join("noext (2)")
        );
    }
}
