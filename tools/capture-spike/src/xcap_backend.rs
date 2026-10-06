//! xcap backend: macOS = CGWindowListCreateImage, Windows = GDI (default) or WGC (`--features wgc`).

use crate::report::{crop, describe, diff, encode_cost, save_png, time_capture, Report, Shot};
use image::codecs::png::{CompressionType, FilterType};
use xcap::{Monitor, Window};

pub fn label() -> &'static str {
    if cfg!(feature = "wgc") {
        "xcap + WGC"
    } else if cfg!(windows) {
        "xcap + GDI"
    } else {
        "xcap (CGWindowListCreateImage)"
    }
}

fn to_shot(img: image::RgbaImage) -> Shot {
    Shot {
        w: img.width(),
        h: img.height(),
        rgba: img.into_raw(),
    }
}

/// Runs everything and returns the full-display shots keyed by display id (for cross-backend diffs).
pub fn run(r: &mut Report) -> Vec<(u32, Shot)> {
    let tag = if cfg!(feature = "wgc") {
        "xcap-wgc"
    } else if cfg!(windows) {
        "xcap-gdi"
    } else {
        "xcap"
    };
    r.h(2, &format!("Backend: {}", label()));
    let mut shots = Vec::new();

    let monitors = match Monitor::all() {
        Ok(m) => m,
        Err(e) => {
            r.line(format!("**Monitor::all() failed:** {e}"));
            return shots;
        }
    };

    r.h(3, "Displays: reported geometry vs captured pixels");
    r.line("| id | name | x,y | reported WxH | scale | expected px | captured px | match | cold ms | warm median ms | content |");
    r.line("|---|---|---|---|---|---|---|---|---|---|---|");
    for m in &monitors {
        let (id, name) = (m.id().unwrap_or(0), m.friendly_name().unwrap_or_default());
        let (x, y) = (m.x().unwrap_or(0), m.y().unwrap_or(0));
        let (w, h) = (m.width().unwrap_or(0), m.height().unwrap_or(0));
        let scale = m.scale_factor().unwrap_or(f32::NAN);
        // macOS reports points (expected = points * scale); Windows reports physical px (expected = reported).
        let (ew, eh) = if cfg!(target_os = "macos") {
            (
                (f64::from(w) * f64::from(scale)).round() as u32,
                (f64::from(h) * f64::from(scale)).round() as u32,
            )
        } else {
            (w, h)
        };
        match time_capture(4, || m.capture_image().map(to_shot).map_err(|e| e.to_string())) {
            Ok((shot, cold, warm)) => {
                let ok = (shot.w, shot.h) == (ew, eh);
                r.line(format!(
                    "| {id} | {name} | {x},{y} | {w}x{h} | {scale:.3} | {ew}x{eh} | {}x{} | {} | {cold:.0} | {warm:.0} | {} |",
                    shot.w, shot.h, if ok { "yes" } else { "**NO**" }, describe(&shot)
                ));
                save_png(&r.dir.clone(), &format!("{tag}-display-{id}.png"), &shot);
                shots.push((id, shot));
            }
            Err(e) => r.line(format!("| {id} | {name} | {x},{y} | {w}x{h} | {scale:.3} | {ew}x{eh} | **error: {e}** | | | | |")),
        }
    }

    // Region capture at the top-left corner: 100x100 in the units the API takes.
    r.h(3, "Region capture (top-left 100x100 in API units)");
    for m in &monitors {
        let id = m.id().unwrap_or(0);
        let scale = f64::from(m.scale_factor().unwrap_or(1.0));
        let expected = if cfg!(target_os = "macos") {
            (100.0 * scale).round() as u32
        } else {
            100
        };
        match m.capture_region(0, 0, 100, 100) {
            Ok(img) => r.line(format!(
                "- display {id}: got {}x{}, expected {expected}x{expected} -> {}",
                img.width(),
                img.height(),
                if img.width() == expected && img.height() == expected {
                    "ok"
                } else {
                    "**MISMATCH**"
                }
            )),
            Err(e) => r.line(format!("- display {id}: error {e}")),
        }
    }

    // Monitor lookup by point at the centre of every monitor (API units).
    r.h(3, "Monitor::from_point at each monitor centre");
    for m in &monitors {
        let (x, y, w, h) = (
            m.x().unwrap_or(0),
            m.y().unwrap_or(0),
            m.width().unwrap_or(0) as i32,
            m.height().unwrap_or(0) as i32,
        );
        let found = Monitor::from_point(x + w / 2, y + h / 2).and_then(|f| f.id());
        r.line(format!(
            "- centre of display {} -> {:?}",
            m.id().unwrap_or(0),
            found.map_err(|e| e.to_string())
        ));
    }

    // PNG encode cost of the biggest frame decides how we hand frozen frames to the overlay.
    if let Some((_, big)) = shots
        .iter()
        .max_by_key(|(_, s)| u64::from(s.w) * u64::from(s.h))
    {
        r.h(
            3,
            &format!("PNG encode cost of the largest frame ({}x{})", big.w, big.h),
        );
        for (name, c, f) in [
            ("default", CompressionType::Default, FilterType::Adaptive),
            ("fast + Sub filter", CompressionType::Fast, FilterType::Sub),
            (
                "fast + no filter",
                CompressionType::Fast,
                FilterType::NoFilter,
            ),
        ] {
            let (ms, bytes) = encode_cost(big, c, f);
            r.line(format!(
                "- {name}: {ms:.0} ms, {:.1} MB",
                bytes as f64 / 1_048_576.0
            ));
        }
    }

    windows_section(r, tag, &monitors, &shots);
    shots
}

fn windows_section(r: &mut Report, tag: &str, monitors: &[Monitor], shots: &[(u32, Shot)]) {
    r.h(3, "Windows: list, bounds vs captured size");
    let all = match Window::all() {
        Ok(w) => w,
        Err(e) => {
            r.line(format!("**Window::all() failed:** {e}"));
            return;
        }
    };
    let titled = all
        .iter()
        .filter(|w| !w.title().unwrap_or_default().is_empty())
        .count();
    r.line(format!("{} windows listed, {titled} with a non-empty title (on macOS, titles of other apps are hidden without Screen Recording permission).", all.len()));
    r.line("");
    r.line("| z | app | title | x,y | bounds WxH | scale | expected px | captured px | match | ms | content |");
    r.line("|---|---|---|---|---|---|---|---|---|---|---|");
    let mut shown = 0;
    for w in &all {
        if shown >= 5 {
            break;
        }
        let (bw, bh) = (w.width().unwrap_or(0), w.height().unwrap_or(0));
        if w.is_minimized().unwrap_or(false) || bw < 150 || bh < 150 {
            continue;
        }
        let scale = w
            .current_monitor()
            .and_then(|m| m.scale_factor())
            .unwrap_or(1.0);
        let (ew, eh) = if cfg!(target_os = "macos") {
            (
                (f64::from(bw) * f64::from(scale)).round() as u32,
                (f64::from(bh) * f64::from(scale)).round() as u32,
            )
        } else {
            (bw, bh)
        };
        let (app, title) = (
            w.app_name().unwrap_or_default(),
            w.title().unwrap_or_default(),
        );
        let t = std::time::Instant::now();
        match w.capture_image() {
            Ok(img) => {
                let ms = t.elapsed().as_secs_f64() * 1000.0;
                let s = to_shot(img);
                let exact = (s.w, s.h) == (ew, eh);
                r.line(format!(
                    "| {} | {app} | {} | {},{} | {bw}x{bh} | {scale:.2} | {ew}x{eh} | {}x{} | {} | {ms:.0} | {} |",
                    w.z().unwrap_or(-1), title.chars().take(24).collect::<String>(), w.x().unwrap_or(0), w.y().unwrap_or(0),
                    s.w, s.h, if exact { "yes" } else { "**differs**" }, describe(&s)
                ));
                save_png(&r.dir.clone(), &format!("{tag}-window-{}.png", w.id().unwrap_or(0)), &s);
                shown += 1;
            }
            Err(e) => r.line(format!("| {} | {app} | {title} | | {bw}x{bh} | {scale:.2} | {ew}x{eh} | **error: {e}** | | | |", w.z().unwrap_or(-1))),
        }
    }
    r.line("");
    r.line("`differs` on macOS usually means the window shadow is included in the image; on Windows it points at invisible DWM borders.");

    // Sanity: window pixels vs the same region cropped from the display shot (only meaningful if both are same content).
    if let Some(w) = all.iter().find(|w| {
        w.width().unwrap_or(0) >= 300
            && w.height().unwrap_or(0) >= 300
            && !w.is_minimized().unwrap_or(true)
    }) {
        let Some(mon) = monitors
            .iter()
            .find(|m| m.id().ok() == w.current_monitor().and_then(|c| c.id()).ok())
        else {
            return;
        };
        let Some((_, display)) = shots.iter().find(|(id, _)| Some(*id) == mon.id().ok()) else {
            return;
        };
        let scale = f64::from(mon.scale_factor().unwrap_or(1.0));
        let to_px = |v: i32, origin: i32| {
            if cfg!(target_os = "macos") {
                (f64::from(v - origin) * scale).round() as i64
            } else {
                i64::from(v - origin)
            }
        };
        let (px, py) = (
            to_px(w.x().unwrap_or(0), mon.x().unwrap_or(0)),
            to_px(w.y().unwrap_or(0), mon.y().unwrap_or(0)),
        );
        let f = if cfg!(target_os = "macos") {
            scale
        } else {
            1.0
        };
        let region = crop(
            display,
            px,
            py,
            (f64::from(w.width().unwrap_or(0)) * f).round() as i64,
            (f64::from(w.height().unwrap_or(0)) * f).round() as i64,
        );
        if let (Ok(img), Some(region)) = (w.capture_image(), region) {
            let shot = to_shot(img);
            let note = match diff(&region, &shot) {
                Some((mean, pct)) => format!("same size; mean abs diff {mean:.2}, {pct:.1}% of pixels differ by >8 (window capture vs crop of display capture)"),
                None => format!("sizes differ: window image {}x{} vs display crop {}x{}", shot.w, shot.h, region.w, region.h),
            };
            r.line(format!(
                "- window '{}' vs display crop: {note}",
                w.title()
                    .unwrap_or_default()
                    .chars()
                    .take(30)
                    .collect::<String>()
            ));
        }
    }
}
