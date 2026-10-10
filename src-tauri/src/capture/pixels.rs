//! Pixel format conversion. Backends deliver BGRA with premultiplied alpha (ScreenCaptureKit,
//! verified with spike data); `Frame` is RGBA with straight alpha, which is what PNG expects.

use super::Frame;

/// Scales a frame down to at most `max_width` pixels wide, keeping the aspect ratio, by averaging
/// every block of source pixels (a box filter: no aliasing, good enough for thumbnails). A frame
/// that is already small enough is returned unchanged.
pub fn downscale(frame: &Frame, max_width: u32) -> Frame {
    if frame.width <= max_width || frame.width == 0 || frame.height == 0 {
        return frame.clone();
    }
    let dw = max_width.max(1);
    let dh = ((u64::from(frame.height) * u64::from(dw) + u64::from(frame.width) / 2)
        / u64::from(frame.width))
    .max(1) as u32;
    let (sw, sh) = (frame.width as usize, frame.height as usize);
    let mut out = vec![0u8; dw as usize * dh as usize * 4];
    for dy in 0..dh as usize {
        let y0 = dy * sh / dh as usize;
        let y1 = ((dy + 1) * sh / dh as usize).max(y0 + 1).min(sh);
        for dx in 0..dw as usize {
            let x0 = dx * sw / dw as usize;
            let x1 = ((dx + 1) * sw / dw as usize).max(x0 + 1).min(sw);
            let mut sum = [0u32; 4];
            for y in y0..y1 {
                let row = &frame.rgba[(y * sw + x0) * 4..(y * sw + x1) * 4];
                for px in row.as_chunks::<4>().0 {
                    for (s, v) in sum.iter_mut().zip(px) {
                        *s += u32::from(*v);
                    }
                }
            }
            let n = ((y1 - y0) * (x1 - x0)) as u32;
            let o = (dy * dw as usize + dx) * 4;
            for (c, s) in sum.iter().enumerate() {
                out[o + c] = ((s + n / 2) / n) as u8;
            }
        }
    }
    Frame {
        width: dw,
        height: dh,
        rgba: out,
    }
}

/// Converts BGRA8 with premultiplied alpha to RGBA8 with straight alpha, in place.
/// Fully opaque pixels (all of a display capture) only get their R and B swapped.
// Only the macOS backend delivers premultiplied BGRA; the math is unit tested on every OS.
#[cfg_attr(not(target_os = "macos"), allow(dead_code))]
pub fn bgra_premultiplied_to_rgba(buf: &mut [u8]) {
    let (pixels, _) = buf.as_chunks_mut::<4>();
    for px in pixels {
        let a = px[3];
        let (b, g, r) = (px[0], px[1], px[2]);
        match a {
            255 => {
                px[0] = r;
                px[2] = b;
            }
            0 => px[..3].copy_from_slice(&[0, 0, 0]),
            _ => {
                let un =
                    |c: u8| ((u32::from(c) * 255 + u32::from(a) / 2) / u32::from(a)).min(255) as u8;
                px[0] = un(r);
                px[1] = un(g);
                px[2] = un(b);
            }
        }
    }
}

/// BGRA8 -> RGBA8 for fully opaque images (display captures), in place. Faster than the general
/// path: no alpha branching, so the compiler vectorises the channel swap. Alpha is forced to 255.
#[cfg_attr(not(target_os = "macos"), allow(dead_code))]
pub fn bgra_opaque_to_rgba(buf: &mut [u8]) {
    let (pixels, _) = buf.as_chunks_mut::<4>();
    for px in pixels {
        px.swap(0, 2);
        px[3] = 255;
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn opaque_fast_path_matches_the_general_path_for_opaque_pixels() {
        let mut a: Vec<u8> = (0..64u8)
            .flat_map(|i| [i, i.wrapping_mul(3), i.wrapping_mul(7), 255])
            .collect();
        let mut b = a.clone();
        bgra_premultiplied_to_rgba(&mut a);
        bgra_opaque_to_rgba(&mut b);
        assert_eq!(a, b);
        let mut c = [1, 2, 3, 17]; // alpha is forced opaque
        bgra_opaque_to_rgba(&mut c);
        assert_eq!(c, [3, 2, 1, 255]);
    }

    #[test]
    fn opaque_pixels_swap_channels_only() {
        let mut p = [10, 20, 30, 255]; // B=10 G=20 R=30
        bgra_premultiplied_to_rgba(&mut p);
        assert_eq!(p, [30, 20, 10, 255]);
    }

    #[test]
    fn premultiplied_alpha_is_undone() {
        // Straight colour (200, 100, 50) at alpha 128 premultiplies to about (100, 50, 25).
        let mut p = [25, 50, 100, 128]; // BGRA premultiplied
        bgra_premultiplied_to_rgba(&mut p);
        assert_eq!(p[3], 128);
        assert!((i32::from(p[0]) - 199).abs() <= 2, "r = {}", p[0]);
        assert!((i32::from(p[1]) - 100).abs() <= 2, "g = {}", p[1]);
        assert!((i32::from(p[2]) - 50).abs() <= 2, "b = {}", p[2]);
    }

    #[test]
    fn transparent_pixels_become_black_and_never_overflow() {
        let mut p = [7, 7, 7, 0];
        bgra_premultiplied_to_rgba(&mut p);
        assert_eq!(p, [0, 0, 0, 0]);
        // Invalid premultiplied data (colour above alpha) saturates instead of wrapping.
        let mut q = [255, 255, 255, 10];
        bgra_premultiplied_to_rgba(&mut q);
        assert_eq!(q, [255, 255, 255, 10]);
    }
}

#[cfg(test)]
mod downscale_tests {
    use super::*;

    fn frame(w: u32, h: u32, f: impl Fn(u32, u32) -> [u8; 4]) -> Frame {
        let mut rgba = Vec::new();
        for y in 0..h {
            for x in 0..w {
                rgba.extend_from_slice(&f(x, y));
            }
        }
        Frame {
            width: w,
            height: h,
            rgba,
        }
    }

    #[test]
    fn keeps_the_aspect_ratio_and_never_upscales() {
        let big = frame(1000, 500, |_, _| [1, 2, 3, 255]);
        let small = downscale(&big, 250);
        assert_eq!((small.width, small.height), (250, 125));
        assert_eq!(small.rgba.len(), 250 * 125 * 4);
        let same = downscale(&big, 2000);
        assert_eq!((same.width, same.height), (1000, 500));
    }

    #[test]
    fn averages_each_block() {
        // 4x2 -> 2x1: left block is (0,0,0,255) and (200,100,50,255) twice each.
        let f = frame(4, 2, |x, _| {
            if x < 2 {
                [0, 0, 0, 255]
            } else {
                [200, 100, 50, 255]
            }
        });
        let d = downscale(&f, 2);
        assert_eq!(&d.rgba[0..4], &[0, 0, 0, 255]);
        assert_eq!(&d.rgba[4..8], &[200, 100, 50, 255]);
        let mixed = frame(2, 2, |x, y| {
            if (x + y) % 2 == 0 {
                [0, 0, 0, 255]
            } else {
                [100, 100, 100, 255]
            }
        });
        assert_eq!(downscale(&mixed, 1).rgba, vec![50, 50, 50, 255]);
    }

    #[test]
    fn a_tall_sliver_still_has_at_least_one_row() {
        let f = frame(1000, 1, |_, _| [9, 9, 9, 255]);
        let d = downscale(&f, 10);
        assert_eq!((d.width, d.height), (10, 1));
    }
}
