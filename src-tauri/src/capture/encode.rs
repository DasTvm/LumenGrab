//! PNG encoding. Two profiles: `Fast` for frozen frames handed to the overlay (must feel instant),
//! `Best` for files the user keeps (runs off the critical path).

use super::{CaptureError, CaptureResult, Frame};

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum Profile {
    /// ~20 ms for a 5K frame (measured), larger output.
    Fast,
    /// ~500 ms for a 5K frame (measured), smaller output.
    Best,
}

pub fn encode_png(frame: &Frame, profile: Profile) -> CaptureResult<Vec<u8>> {
    let expected = frame.width as usize * frame.height as usize * 4;
    if frame.width == 0 || frame.height == 0 || frame.rgba.len() != expected {
        return Err(CaptureError::Backend("malformed frame".into()));
    }
    let mut out = Vec::with_capacity(expected / 4);
    let mut enc = png::Encoder::new(&mut out, frame.width, frame.height);
    enc.set_color(png::ColorType::Rgba);
    enc.set_depth(png::BitDepth::Eight);
    match profile {
        Profile::Fast => {
            enc.set_compression(png::Compression::Fast);
            enc.set_filter(png::Filter::Sub);
        }
        Profile::Best => {
            enc.set_compression(png::Compression::Balanced);
            enc.set_filter(png::Filter::Adaptive);
        }
    }
    let mut writer = enc
        .write_header()
        .map_err(|e| CaptureError::Backend(e.to_string()))?;
    writer
        .write_image_data(&frame.rgba)
        .map_err(|e| CaptureError::Backend(e.to_string()))?;
    writer
        .finish()
        .map_err(|e| CaptureError::Backend(e.to_string()))?;
    Ok(out)
}

#[cfg(test)]
mod tests {
    use super::*;

    fn gradient(w: u32, h: u32) -> Frame {
        let mut rgba = Vec::new();
        for y in 0..h {
            for x in 0..w {
                rgba.extend_from_slice(&[
                    (x * 7) as u8,
                    (y * 5) as u8,
                    (x + y) as u8,
                    255 - (x as u8),
                ]);
            }
        }
        Frame {
            width: w,
            height: h,
            rgba,
        }
    }

    fn decode(png_bytes: &[u8]) -> (u32, u32, Vec<u8>) {
        let dec = png::Decoder::new(std::io::Cursor::new(png_bytes));
        let mut reader = dec.read_info().unwrap();
        let mut buf = vec![0; reader.output_buffer_size().unwrap()];
        let info = reader.next_frame(&mut buf).unwrap();
        buf.truncate(info.buffer_size());
        (info.width, info.height, buf)
    }

    #[test]
    fn both_profiles_roundtrip_losslessly() {
        let f = gradient(37, 23);
        for p in [Profile::Fast, Profile::Best] {
            let (w, h, pixels) = decode(&encode_png(&f, p).unwrap());
            assert_eq!((w, h), (37, 23));
            assert_eq!(
                pixels, f.rgba,
                "profile {p:?} must be lossless, including alpha"
            );
        }
    }

    #[test]
    fn malformed_frames_are_rejected() {
        assert!(encode_png(
            &Frame {
                width: 0,
                height: 0,
                rgba: vec![]
            },
            Profile::Fast
        )
        .is_err());
        assert!(encode_png(
            &Frame {
                width: 2,
                height: 2,
                rgba: vec![0; 15]
            },
            Profile::Fast
        )
        .is_err());
    }
}
