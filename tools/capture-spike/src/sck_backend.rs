//! macOS ScreenCaptureKit backend via the `screencapturekit` crate (SCScreenshotManager stills).

use crate::report::{crop, describe, diff, save_png, time_capture, Report, Shot};
use screencapturekit::{
    prelude::*,
    screenshot_manager::{CGImageExt, SCScreenshotManager},
    shareable_content::SCShareableContentInfo,
};

fn grab(filter: &SCContentFilter, config: &SCStreamConfiguration) -> Result<Shot, String> {
    let img = SCScreenshotManager::capture_image(filter, config).map_err(|e| e.to_string())?;
    let (w, h) = (img.width() as u32, img.height() as u32);
    let rgba = img.rgba_data().map_err(|e| e.to_string())?;
    if rgba.len() != (w as usize) * (h as usize) * 4 {
        return Err(format!(
            "unexpected pixel buffer: {} bytes for {w}x{h}",
            rgba.len()
        ));
    }
    Ok(Shot { w, h, rgba })
}

pub fn run(r: &mut Report, xcap_shots: &[(u32, Shot)]) {
    r.h(
        2,
        "Backend: ScreenCaptureKit (screencapturekit 11, SCScreenshotManager)",
    );

    let content = match SCShareableContent::get() {
        Ok(c) => c,
        Err(e) => {
            r.line(format!("**SCShareableContent::get() failed:** `{e}`"));
            r.line("Without Screen Recording permission ScreenCaptureKit refuses to enumerate content (it errors instead of returning blank images).");
            return;
        }
    };

    r.h(3, "Displays: reported geometry vs captured pixels");
    r.line("| id | frame (points) | filter scale | filter pixel size | default-config px | native-config px | match | cold ms | warm median ms | vs xcap (mean abs diff / % >8) |");
    r.line("|---|---|---|---|---|---|---|---|---|---|");
    let mut native: Vec<(u32, f64, f64, f64, f64, f64, Shot)> = Vec::new(); // id, x, y, scale, w_pts, h_pts, shot
    for d in content.displays() {
        let id = d.display_id();
        let f = d.frame();
        let filter = match SCContentFilter::create()
            .with_display(&d)
            .with_excluding_windows(&[])
            .build()
        {
            Ok(f) => f,
            Err(e) => {
                r.line(format!("| {id} | | | | **filter error: {e}** | | | | | |"));
                continue;
            }
        };
        let (scale, (iw, ih)) = SCShareableContentInfo::for_filter(&filter)
            .map(|i| (f64::from(i.point_pixel_scale()), i.pixel_size()))
            .unwrap_or((f64::NAN, (0, 0)));
        let default_px = grab(&filter, &SCStreamConfiguration::new())
            .map(|s| format!("{}x{}", s.w, s.h))
            .unwrap_or_else(|e| format!("error: {e}"));
        let cfg = SCStreamConfiguration::new().with_width(iw).with_height(ih);
        match time_capture(4, || grab(&filter, &cfg)) {
            Ok((shot, cold, warm)) => {
                let cmp = xcap_shots
                    .iter()
                    .find(|(xid, _)| *xid == id)
                    .and_then(|(_, xs)| diff(xs, &shot))
                    .map(|(m, p)| format!("{m:.2} / {p:.1}%"))
                    .unwrap_or_else(|| "n/a (no xcap shot or size differs)".into());
                r.line(format!(
                    "| {id} | {:.0},{:.0} {:.0}x{:.0} | {scale:.2} | {iw}x{ih} | {default_px} | {}x{} | {} | {cold:.0} | {warm:.0} | {cmp} |",
                    f.origin.x, f.origin.y, f.size.width, f.size.height, shot.w, shot.h,
                    if (shot.w, shot.h) == (iw, ih) { "yes" } else { "**NO**" }
                ));
                r.line(format!("<!-- content: {} -->", describe(&shot)));
                save_png(&r.dir.clone(), &format!("sck-display-{id}.png"), &shot);
                native.push((
                    id,
                    f.origin.x,
                    f.origin.y,
                    scale,
                    f.size.width,
                    f.size.height,
                    shot,
                ));
            }
            Err(e) => r.line(format!(
                "| {id} | | {scale:.2} | {iw}x{ih} | {default_px} | **error: {e}** | | | | |"
            )),
        }
    }

    // Region capture (15.2+): top-left 100x100 points of the main display.
    r.h(
        3,
        "Region capture (SCScreenshotManager::capture_image_in_rect, 100x100 points at 0,0)",
    );
    match SCScreenshotManager::capture_image_in_rect(CGRect::new(0.0, 0.0, 100.0, 100.0)) {
        Ok(img) => r.line(format!(
            "- got {}x{} px (expected 100 x scale)",
            img.width(),
            img.height()
        )),
        Err(e) => r.line(format!("- error: `{e}`")),
    }

    // Windows: native size with and without shadow, plus the exclusion demo.
    r.h(3, "Windows: native capture size with and without shadow");
    let candidates: Vec<SCWindow> = content
        .windows()
        .into_iter()
        .filter(|w| {
            let f = w.frame();
            w.is_on_screen()
                && w.window_layer() == 0
                && f.size.width >= 150.0
                && f.size.height >= 150.0
                && w.title().is_some_and(|t| !t.is_empty())
        })
        .take(4)
        .collect();
    r.line(format!("{} candidate on-screen layer-0 windows with titles (titles are only visible with permission).", candidates.len()));
    r.line("");
    r.line("| window id | app | frame (points) | filter content rect | filter px | default cfg px | shadows kept px | shadows ignored px | ms |");
    r.line("|---|---|---|---|---|---|---|---|---|");
    for w in &candidates {
        let f = w.frame();
        let app = w
            .owning_application()
            .map(|a| a.application_name())
            .unwrap_or_default();
        let Ok(filter) = SCContentFilter::create().with_window(w).build() else {
            continue;
        };
        let info = SCShareableContentInfo::for_filter(&filter);
        let (cr, (pw, ph)) = info
            .map(|i| (i.content_rect(), i.pixel_size()))
            .unwrap_or((CGRect::new(0.0, 0.0, 0.0, 0.0), (0, 0)));
        let default_px = grab(&filter, &SCStreamConfiguration::new())
            .map(|s| format!("{}x{}", s.w, s.h))
            .unwrap_or_else(|e| format!("error: {e}"));
        let mk = |ignore: bool| {
            SCStreamConfiguration::new()
                .with_width(pw)
                .with_height(ph)
                .with_ignores_shadows_single_window(ignore)
        };
        let t = std::time::Instant::now();
        let kept = mk(false)
            .map_err(|e| e.to_string())
            .and_then(|c| grab(&filter, &c));
        let ms = t.elapsed().as_secs_f64() * 1000.0;
        let ignored = mk(true)
            .map_err(|e| e.to_string())
            .and_then(|c| grab(&filter, &c));
        let fmt = |s: &Result<Shot, String>| {
            s.as_ref()
                .map(|s| format!("{}x{}", s.w, s.h))
                .unwrap_or_else(|e| format!("error: {e}"))
        };
        r.line(format!(
            "| {} | {app} | {:.0},{:.0} {:.0}x{:.0} | {:.0},{:.0} {:.0}x{:.0} | {pw}x{ph} | {default_px} | {} | {} | {ms:.0} |",
            w.window_id(), f.origin.x, f.origin.y, f.size.width, f.size.height,
            cr.origin.x, cr.origin.y, cr.size.width, cr.size.height, fmt(&kept), fmt(&ignored)
        ));
        if let Ok(s) = &kept {
            save_png(
                &r.dir.clone(),
                &format!("sck-window-{}-shadow.png", w.window_id()),
                s,
            );
        }
        if let Ok(s) = &ignored {
            save_png(
                &r.dir.clone(),
                &format!("sck-window-{}-noshadow.png", w.window_id()),
                s,
            );
        }
    }

    // Exclusion demo: capture the display with and without one window excluded, compare that window's region.
    r.h(
        3,
        "Excluding a window from a display capture (stand-in for our own overlay)",
    );
    if let Some(w) = candidates.first() {
        let f = w.frame();
        let centre = (
            f.origin.x + f.size.width / 2.0,
            f.origin.y + f.size.height / 2.0,
        );
        let target = content.displays().into_iter().find(|d| {
            let df = d.frame();
            centre.0 >= df.origin.x
                && centre.0 < df.origin.x + df.size.width
                && centre.1 >= df.origin.y
                && centre.1 < df.origin.y + df.size.height
        });
        if let Some(d) = target {
            let df = d.frame();
            let build = |excluded: &[&SCWindow]| {
                SCContentFilter::create()
                    .with_display(&d)
                    .with_excluding_windows(excluded)
                    .build()
            };
            if let (Ok(all), Ok(ex)) = (build(&[]), build(&[w])) {
                if let Some(info) = SCShareableContentInfo::for_filter(&all) {
                    let (iw, ih) = info.pixel_size();
                    let scale = f64::from(info.point_pixel_scale());
                    let cfg = SCStreamConfiguration::new().with_width(iw).with_height(ih);
                    if let (Ok(a), Ok(b)) = (grab(&all, &cfg), grab(&ex, &cfg)) {
                        let (px, py) = (
                            ((f.origin.x - df.origin.x) * scale).round() as i64,
                            ((f.origin.y - df.origin.y) * scale).round() as i64,
                        );
                        let (pw, ph) = (
                            (f.size.width * scale).round() as i64,
                            (f.size.height * scale).round() as i64,
                        );
                        if let (Some(ca), Some(cb)) =
                            (crop(&a, px, py, pw, ph), crop(&b, px, py, pw, ph))
                        {
                            let d = diff(&ca, &cb)
                                .map(|(m, p)| {
                                    format!("mean abs diff {m:.1}, {p:.1}% of pixels differ by >8")
                                })
                                .unwrap_or_else(|| "size mismatch".into());
                            r.line(format!("- excluded window {} ({} px region): {d}. A large difference means the window really disappeared from the capture.", w.window_id(), pw * ph));
                            save_png(&r.dir.clone(), "sck-exclusion-with.png", &ca);
                            save_png(&r.dir.clone(), "sck-exclusion-without.png", &cb);
                        }
                    }
                }
            }
        } else {
            r.line("- could not match the window to a display");
        }
    } else {
        r.line("- no candidate window (likely no permission: titles are hidden)");
    }
}
