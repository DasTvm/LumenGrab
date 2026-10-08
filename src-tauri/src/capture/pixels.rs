//! Pixel format conversion. Backends deliver BGRA with premultiplied alpha (ScreenCaptureKit,
//! verified with spike data); `Frame` is RGBA with straight alpha, which is what PNG expects.

/// Converts BGRA8 with premultiplied alpha to RGBA8 with straight alpha, in place.
/// Fully opaque pixels (all of a display capture) only get their R and B swapped.
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

#[cfg(test)]
mod tests {
    use super::*;

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
