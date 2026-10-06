//! Shared helpers: Markdown report, timing, PNG output, pixel statistics.

use std::{
    fs,
    path::{Path, PathBuf},
    time::Instant,
};

use image::{
    codecs::png::{CompressionType, FilterType, PngEncoder},
    ExtendedColorType, ImageEncoder,
};

/// A captured frame in physical pixels, tightly packed RGBA8.
pub struct Shot {
    pub w: u32,
    pub h: u32,
    pub rgba: Vec<u8>,
}

pub struct Report {
    text: String,
    pub dir: PathBuf,
}

impl Report {
    pub fn new(dir: PathBuf) -> Self {
        fs::create_dir_all(&dir).expect("create output dir");
        Self {
            text: String::new(),
            dir,
        }
    }

    pub fn line(&mut self, s: impl AsRef<str>) {
        println!("{}", s.as_ref());
        self.text.push_str(s.as_ref());
        self.text.push('\n');
    }

    pub fn h(&mut self, level: usize, title: &str) {
        self.line("");
        self.line(format!("{} {title}", "#".repeat(level)));
        self.line("");
    }

    pub fn save(&self, name: &str) -> PathBuf {
        let path = self.dir.join(name);
        fs::write(&path, &self.text).expect("write report");
        path
    }
}

/// Runs `f` once cold, then `warm` more times. Returns the last frame, cold ms and median warm ms.
pub fn time_capture(
    warm: usize,
    mut f: impl FnMut() -> Result<Shot, String>,
) -> Result<(Shot, f64, f64), String> {
    let t = Instant::now();
    let mut last = f()?;
    let cold = t.elapsed().as_secs_f64() * 1000.0;
    let mut samples = Vec::new();
    for _ in 0..warm {
        let t = Instant::now();
        last = f()?;
        samples.push(t.elapsed().as_secs_f64() * 1000.0);
    }
    samples.sort_by(|a, b| a.total_cmp(b));
    let median = samples.get(samples.len() / 2).copied().unwrap_or(f64::NAN);
    Ok((last, cold, median))
}

pub fn save_png(dir: &Path, name: &str, shot: &Shot) -> PathBuf {
    let path = dir.join(name);
    let mut buf = Vec::new();
    PngEncoder::new_with_quality(&mut buf, CompressionType::Fast, FilterType::Sub)
        .write_image(&shot.rgba, shot.w, shot.h, ExtendedColorType::Rgba8)
        .expect("encode png");
    fs::write(&path, buf).expect("write png");
    path
}

/// (milliseconds, bytes) to PNG-encode `shot` with the given settings.
pub fn encode_cost(shot: &Shot, c: CompressionType, f: FilterType) -> (f64, usize) {
    let t = Instant::now();
    let mut buf = Vec::new();
    PngEncoder::new_with_quality(&mut buf, c, f)
        .write_image(&shot.rgba, shot.w, shot.h, ExtendedColorType::Rgba8)
        .expect("encode png");
    (t.elapsed().as_secs_f64() * 1000.0, buf.len())
}

/// Cheap "is this real content?" signal: distinct colours in a coarse sample, mean luma, alpha.
pub fn describe(s: &Shot) -> String {
    use std::collections::HashSet;
    let (w, h) = (s.w as usize, s.h as usize);
    if w == 0 || h == 0 || s.rgba.len() < w * h * 4 {
        return "empty or malformed".into();
    }
    let step_x = (w / 64).max(1);
    let step_y = (h / 64).max(1);
    let mut colours = HashSet::new();
    let (mut luma, mut n, mut min_a) = (0f64, 0f64, 255u8);
    for y in (0..h).step_by(step_y) {
        for x in (0..w).step_by(step_x) {
            let i = (y * w + x) * 4;
            let p = &s.rgba[i..i + 4];
            colours.insert([p[0] >> 3, p[1] >> 3, p[2] >> 3]);
            luma += 0.2126 * f64::from(p[0]) + 0.7152 * f64::from(p[1]) + 0.0722 * f64::from(p[2]);
            n += 1.0;
            min_a = min_a.min(p[3]);
        }
    }
    format!(
        "{} distinct colours (coarse sample), mean luma {:.0}, min alpha {}",
        colours.len(),
        luma / n,
        min_a
    )
}

/// Mean absolute channel difference and % of pixels differing by more than 8 (RGB), same-size images.
pub fn diff(a: &Shot, b: &Shot) -> Option<(f64, f64)> {
    if a.w != b.w || a.h != b.h || a.rgba.len() != b.rgba.len() {
        return None;
    }
    let (mut sum, mut over, mut px) = (0u64, 0u64, 0u64);
    for (pa, pb) in a.rgba.chunks_exact(4).zip(b.rgba.chunks_exact(4)) {
        let d: Vec<i32> = (0..3)
            .map(|i| (i32::from(pa[i]) - i32::from(pb[i])).abs())
            .collect();
        sum += d.iter().map(|&v| v as u64).sum::<u64>();
        if d.iter().any(|&v| v > 8) {
            over += 1;
        }
        px += 1;
    }
    Some((
        sum as f64 / (px * 3) as f64,
        over as f64 * 100.0 / px as f64,
    ))
}

/// Crop `shot` to the pixel rect (clamped); used to compare a window's region between two captures.
pub fn crop(shot: &Shot, x: i64, y: i64, w: i64, h: i64) -> Option<Shot> {
    let x0 = x.clamp(0, i64::from(shot.w));
    let y0 = y.clamp(0, i64::from(shot.h));
    let x1 = (x + w).clamp(0, i64::from(shot.w));
    let y1 = (y + h).clamp(0, i64::from(shot.h));
    if x1 <= x0 || y1 <= y0 {
        return None;
    }
    let (cw, ch) = ((x1 - x0) as usize, (y1 - y0) as usize);
    let mut rgba = Vec::with_capacity(cw * ch * 4);
    for row in y0 as usize..y1 as usize {
        let start = (row * shot.w as usize + x0 as usize) * 4;
        rgba.extend_from_slice(&shot.rgba[start..start + cw * 4]);
    }
    Some(Shot {
        w: cw as u32,
        h: ch as u32,
        rgba,
    })
}
