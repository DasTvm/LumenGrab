//! Text recognition with `Windows.Media.Ocr`. On the device, no network. It needs an OCR language
//! pack (a free Windows feature); without one the engine cannot be created and the page says so.

use windows::{
    Graphics::Imaging::BitmapDecoder,
    Media::Ocr::OcrEngine,
    Storage::Streams::{DataWriter, InMemoryRandomAccessStream},
    Win32::System::WinRT::{RoInitialize, RO_INIT_MULTITHREADED},
};

use crate::{
    capture::{encode, pixels, Frame},
    ocr::{Line, NO_LANGUAGE_PACK},
};

fn failed(what: &str, e: &windows::core::Error) -> String {
    format!("Text recognition failed ({what}): {e}")
}

/// Reads the text lines of a PNG, in pixels of `frame`, origin top-left.
pub fn recognize_text(png: &[u8], frame: &Frame) -> Result<Vec<Line>, String> {
    // Worker threads have not started the Windows Runtime yet. Already started is fine.
    // SAFETY: a plain initialisation call with a valid constant.
    let _ = unsafe { RoInitialize(RO_INIT_MULTITHREADED) };

    let engine =
        OcrEngine::TryCreateFromUserProfileLanguages().map_err(|_| NO_LANGUAGE_PACK.to_string())?;
    // The engine reads pictures up to a maximum edge; larger ones are scaled down and the boxes scaled back.
    let max = OcrEngine::MaxImageDimension().map_err(|e| failed("size", &e))?;
    let long = frame.width.max(frame.height);
    let (bytes, scale) = if long > max {
        let k = f64::from(max) / f64::from(long);
        let width = (f64::from(frame.width) * k).floor().max(1.0) as u32;
        let small = pixels::downscale(frame, width);
        let scale = f64::from(frame.width) / f64::from(small.width);
        (
            encode::encode_png(&small, encode::Profile::Fast).map_err(|e| e.to_string())?,
            scale,
        )
    } else {
        (png.to_vec(), 1.0)
    };

    let stream = InMemoryRandomAccessStream::new().map_err(|e| failed("stream", &e))?;
    let writer = DataWriter::CreateDataWriter(&stream).map_err(|e| failed("writer", &e))?;
    writer.WriteBytes(&bytes).map_err(|e| failed("bytes", &e))?;
    writer
        .StoreAsync()
        .and_then(|op| op.join())
        .map_err(|e| failed("store", &e))?;
    let _ = writer.DetachStream();
    stream.Seek(0).map_err(|e| failed("seek", &e))?;
    let decoder = BitmapDecoder::CreateAsync(&stream)
        .and_then(|op| op.join())
        .map_err(|e| failed("decode", &e))?;
    let bitmap = decoder
        .GetSoftwareBitmapAsync()
        .and_then(|op| op.join())
        .map_err(|e| failed("bitmap", &e))?;
    let result = engine
        .RecognizeAsync(&bitmap)
        .and_then(|op| op.join())
        .map_err(|e| failed("recognize", &e))?;

    let mut lines = Vec::new();
    for line in result.Lines().map_err(|e| failed("lines", &e))? {
        let text = line.Text().map_err(|e| failed("text", &e))?.to_string();
        // A line's box is the union of its words' boxes.
        let (mut left, mut top, mut right, mut bottom) = (f64::MAX, f64::MAX, f64::MIN, f64::MIN);
        for word in line.Words().map_err(|e| failed("words", &e))? {
            let r = word.BoundingRect().map_err(|e| failed("box", &e))?;
            left = left.min(f64::from(r.X));
            top = top.min(f64::from(r.Y));
            right = right.max(f64::from(r.X + r.Width));
            bottom = bottom.max(f64::from(r.Y + r.Height));
        }
        if right <= left || bottom <= top {
            continue;
        }
        lines.push(Line {
            text,
            x: left * scale,
            y: top * scale,
            width: (right - left) * scale,
            height: (bottom - top) * scale,
        });
    }
    Ok(lines)
}
