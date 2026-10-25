//! Reading text and QR codes out of a picture (M6, docs/adr/0012-text-recognition.md).
//!
//! Text comes from the operating system's own engine (macOS Vision, Windows.Media.Ocr) behind
//! `platform::recognize_text`, so nothing is installed and nothing leaves the computer. QR codes are
//! read here, in Rust, with the same code on both systems.
//!
//! The picture is always **what the user sees or exports** (the flattened render), never the original
//! of a `.lumengrab`, so text that a redaction destroyed cannot come back through "Copy text".

use serde::Serialize;
use tauri::{ipc::Request, AppHandle};
use tauri_plugin_clipboard_manager::ClipboardExt;

use crate::{
    capture::{encode, pixels, Frame},
    history, platform, quick_access,
};

/// The error text the page maps to "No language pack" (Windows only).
#[cfg_attr(not(target_os = "windows"), allow(dead_code))]
pub const NO_LANGUAGE_PACK: &str = "NO_LANGUAGE_PACK";
/// Pictures larger than this (on the long edge) are scaled down for the QR search.
const QR_MAX_EDGE: u32 = 2400;
/// Largest text the clipboard command takes.
const MAX_CLIPBOARD_TEXT: usize = 2_000_000;
/// A link longer than this is not opened.
const MAX_LINK: usize = 2048;

/// One line of text the engine found, in pixels of the picture it was given (top-left origin).
#[derive(Clone, Debug, PartialEq)]
pub struct Line {
    pub text: String,
    pub x: f64,
    pub y: f64,
    pub width: f64,
    pub height: f64,
}

/// A block of neighbouring lines (a paragraph, a form field), in pixels of the picture.
#[derive(Clone, Debug, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct TextBlock {
    pub text: String,
    pub x: f64,
    pub y: f64,
    pub width: f64,
    pub height: f64,
}

#[derive(Clone, Debug, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Code {
    pub value: String,
    pub x: f64,
    pub y: f64,
    pub width: f64,
    pub height: f64,
}

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct TextRecognition {
    /// Every block's text, one block per paragraph, in reading order.
    pub text: String,
    pub words: usize,
    pub blocks: Vec<TextBlock>,
    pub codes: Vec<Code>,
}

// ---- grouping ---------------------------------------------------------------------------------------

/// Joins lines that belong together (the next line is right below and starts about where this one does)
/// into blocks, top to bottom. Lines that stand apart stay their own block.
pub fn group_lines(mut lines: Vec<Line>) -> Vec<TextBlock> {
    lines.retain(|l| !l.text.trim().is_empty());
    lines.sort_by(|a, b| {
        a.y.partial_cmp(&b.y)
            .unwrap_or(std::cmp::Ordering::Equal)
            .then(a.x.partial_cmp(&b.x).unwrap_or(std::cmp::Ordering::Equal))
    });
    let mut blocks: Vec<TextBlock> = Vec::new();
    // The last line of each open block, to measure the gap to the next line.
    let mut last: Vec<Line> = Vec::new();
    for line in lines {
        let joined = last.iter().position(|prev| {
            let gap = line.y - (prev.y + prev.height);
            let tall = prev.height.max(line.height);
            let same_column = (line.x - prev.x).abs() <= tall * 1.5;
            gap <= tall * 0.6 && gap > -tall * 0.5 && same_column
        });
        if let Some(i) = joined {
            let block = &mut blocks[i];
            block.text.push('\n');
            block.text.push_str(line.text.trim());
            let right = (block.x + block.width).max(line.x + line.width);
            let bottom = (block.y + block.height).max(line.y + line.height);
            block.x = block.x.min(line.x);
            block.y = block.y.min(line.y);
            block.width = right - block.x;
            block.height = bottom - block.y;
            last[i] = line;
        } else {
            blocks.push(TextBlock {
                text: line.text.trim().to_string(),
                x: line.x,
                y: line.y,
                width: line.width,
                height: line.height,
            });
            last.push(line);
        }
    }
    blocks.sort_by(|a, b| {
        a.y.partial_cmp(&b.y)
            .unwrap_or(std::cmp::Ordering::Equal)
            .then(a.x.partial_cmp(&b.x).unwrap_or(std::cmp::Ordering::Equal))
    });
    blocks
}

fn count_words(text: &str) -> usize {
    text.split_whitespace().count()
}

// ---- QR codes ---------------------------------------------------------------------------------------

/// Finds the QR codes of a picture. A code that cannot be read is skipped.
pub fn find_codes(frame: &Frame) -> Vec<Code> {
    let long = frame.width.max(frame.height);
    let (small, scale) = if long > QR_MAX_EDGE {
        let k = f64::from(QR_MAX_EDGE) / f64::from(long);
        let width = (f64::from(frame.width) * k).round().max(1.0) as u32;
        (
            pixels::downscale(frame, width),
            f64::from(frame.width) / f64::from(width),
        )
    } else {
        (frame.clone(), 1.0)
    };
    let (w, h) = (small.width as usize, small.height as usize);
    let gray: Vec<u8> = small
        .rgba
        .as_chunks::<4>()
        .0
        .iter()
        .map(|p| {
            ((u32::from(p[0]) * 299 + u32::from(p[1]) * 587 + u32::from(p[2]) * 114) / 1000) as u8
        })
        .collect();
    let mut prepared = rqrr::PreparedImage::prepare_from_greyscale(w, h, |x, y| gray[y * w + x]);
    prepared
        .detect_grids()
        .into_iter()
        .filter_map(|grid| {
            let (_, value) = grid.decode().ok()?;
            let xs = grid.bounds.map(|p| f64::from(p.x));
            let ys = grid.bounds.map(|p| f64::from(p.y));
            let (min_x, max_x) = (
                xs.iter().copied().fold(f64::MAX, f64::min),
                xs.iter().copied().fold(f64::MIN, f64::max),
            );
            let (min_y, max_y) = (
                ys.iter().copied().fold(f64::MAX, f64::min),
                ys.iter().copied().fold(f64::MIN, f64::max),
            );
            Some(Code {
                value,
                x: (min_x * scale).max(0.0),
                y: (min_y * scale).max(0.0),
                width: (max_x - min_x) * scale,
                height: (max_y - min_y) * scale,
            })
        })
        .collect()
}

// ---- the whole read ---------------------------------------------------------------------------------

/// Reads the text and the QR codes of a PNG. Slow (a second or more for a large picture): call it
/// from a worker thread.
pub fn recognize_png(png: &[u8]) -> Result<TextRecognition, String> {
    #[cfg(any(debug_assertions, feature = "dev-hooks"))]
    let started = std::time::Instant::now();
    let frame = encode::decode_png(png).map_err(|e| e.to_string())?;
    #[cfg(any(debug_assertions, feature = "dev-hooks"))]
    eprintln!(
        "[lumengrab:dev] ocr: decoded in {} ms",
        started.elapsed().as_millis()
    );
    let lines = platform::recognize_text(png, &frame)?;
    #[cfg(any(debug_assertions, feature = "dev-hooks"))]
    eprintln!(
        "[lumengrab:dev] ocr: engine done in {} ms",
        started.elapsed().as_millis()
    );
    let blocks = group_lines(lines);
    let codes = find_codes(&frame);
    #[cfg(any(debug_assertions, feature = "dev-hooks"))]
    eprintln!(
        "[lumengrab:dev] ocr: codes done in {} ms",
        started.elapsed().as_millis()
    );
    let text = blocks
        .iter()
        .map(|b| b.text.as_str())
        .collect::<Vec<_>>()
        .join("\n");
    Ok(TextRecognition {
        words: count_words(&text),
        text,
        blocks,
        codes,
    })
}

async fn read_blocking(png: Vec<u8>) -> Result<TextRecognition, String> {
    tauri::async_runtime::spawn_blocking(move || recognize_png(&png))
        .await
        .map_err(|e| format!("Reading the text stopped unexpectedly: {e}"))?
}

// ---- commands ---------------------------------------------------------------------------------------

/// The editor sends the picture it exports (a PNG, as the raw request body).
#[tauri::command]
pub async fn text_recognize(request: Request<'_>) -> Result<TextRecognition, String> {
    let tauri::ipc::InvokeBody::Raw(bytes) = request.body() else {
        return Err("The picture is missing.".into());
    };
    read_blocking(bytes.clone()).await
}

/// The picture of a Quick Access card.
#[tauri::command]
pub async fn text_recognize_card(app: AppHandle, id: String) -> Result<TextRecognition, String> {
    let path = quick_access::file_of(&app, &id).ok_or("This screenshot is no longer available.")?;
    let bytes = std::fs::read(&path).map_err(|e| format!("{}: {e}", path.display()))?;
    read_blocking(bytes).await
}

/// The picture of a History entry.
#[tauri::command]
pub async fn text_recognize_history(app: AppHandle, id: String) -> Result<TextRecognition, String> {
    let path = history::picture_path(&app, &id)?;
    let bytes = std::fs::read(&path).map_err(|e| format!("{}: {e}", path.display()))?;
    read_blocking(bytes).await
}

/// Reads a picture and answers with a card in the screen corner: the text is on the clipboard, or a QR
/// link is offered, or it says why nothing came out. Used where no window of ours is open (the pin
/// menu, a text capture). Blocking: call from a worker thread.
pub fn read_and_tell(app: &AppHandle, png: &[u8]) {
    use quick_access::notice;
    let card = match recognize_png(png) {
        Ok(found) => {
            let link = found
                .codes
                .iter()
                .map(|c| c.value.clone())
                .find(|v| is_openable_link(v));
            let copied =
                !found.text.is_empty() && app.clipboard().write_text(found.text.clone()).is_ok();
            match (link, copied) {
                (Some(link), _) => notice::qr_found(link),
                (None, true) => notice::text_copied(found.words),
                (None, false) if found.text.is_empty() => notice::no_text(),
                (None, false) => notice::text_failed("The clipboard did not take the text.".into()),
            }
        }
        Err(e) if e == NO_LANGUAGE_PACK => notice::no_language_pack(),
        Err(e) => notice::text_failed(e),
    };
    quick_access::notify(app, card);
}

/// Puts text on the clipboard (the page may not write it itself).
#[tauri::command]
pub async fn text_copy(app: AppHandle, text: String) -> Result<(), String> {
    if text.len() > MAX_CLIPBOARD_TEXT {
        return Err("That is too much text to copy.".into());
    }
    app.clipboard().write_text(text).map_err(|e| e.to_string())
}

/// Whether a link may be opened: http or https only, one line, a sane length, a host.
pub fn is_openable_link(link: &str) -> bool {
    if link.is_empty()
        || link.len() > MAX_LINK
        || link.chars().any(|c| c.is_control() || c.is_whitespace())
    {
        return false;
    }
    let Some(rest) = link
        .strip_prefix("https://")
        .or_else(|| link.strip_prefix("http://"))
    else {
        return false;
    };
    let host = rest.split(['/', '?', '#']).next().unwrap_or_default();
    // No credentials in front of the host (`https://bank.com@evil.example`) and a real host name.
    !host.is_empty() && !host.contains('@') && host.chars().any(|c| c.is_ascii_alphanumeric())
}

/// Windows: the page where a language pack for text recognition is added.
#[tauri::command]
pub fn text_open_language_settings() {
    platform::open_url("ms-settings:regionlanguage");
}

/// "Open" of a link read from a QR code, after the page asked the user (the dialog shows the whole address).
#[tauri::command]
pub fn link_open(link: String) -> Result<(), String> {
    if !is_openable_link(&link) {
        return Err(
            "This address cannot be opened: only web addresses (http or https) are allowed.".into(),
        );
    }
    platform::open_url(&link);
    Ok(())
}

/// Like `link_open`, for windows that have no room for a question (a Quick Access card): a native
/// dialog shows the whole address first. Returns whether it was opened.
#[tauri::command]
pub async fn link_open_confirmed(app: AppHandle, link: String) -> Result<bool, String> {
    use tauri_plugin_dialog::{DialogExt, MessageDialogButtons, MessageDialogKind};
    if !is_openable_link(&link) {
        return Err(
            "This address cannot be opened: only web addresses (http or https) are allowed.".into(),
        );
    }
    let ok = app
        .dialog()
        .message(format!(
            "LumenGrab read this address from your picture:\n\n{link}\n\nAddresses in pictures can be misleading. Only open links you trust."
        ))
        .title("Open this link?")
        .kind(MessageDialogKind::Warning)
        .buttons(MessageDialogButtons::OkCancelCustom("Open".into(), "Cancel".into()))
        .blocking_show();
    if ok {
        platform::open_url(&link);
    }
    Ok(ok)
}

#[cfg(test)]
mod tests {
    use super::*;

    fn line(text: &str, x: f64, y: f64, width: f64, height: f64) -> Line {
        Line {
            text: text.into(),
            x,
            y,
            width,
            height,
        }
    }

    #[test]
    fn lines_that_follow_each_other_become_one_block_and_others_stay_apart() {
        let blocks = group_lines(vec![
            line("Total $48.00", 40.0, 300.0, 200.0, 20.0),
            line("Order summary", 40.0, 100.0, 180.0, 20.0),
            line("Pro plan $42.00", 40.0, 124.0, 190.0, 20.0),
            line("Tax $6.00", 42.0, 148.0, 120.0, 20.0),
            line("Checkout", 40.0, 20.0, 150.0, 30.0),
        ]);
        let texts: Vec<&str> = blocks.iter().map(|b| b.text.as_str()).collect();
        assert_eq!(
            texts,
            [
                "Checkout",
                "Order summary\nPro plan $42.00\nTax $6.00",
                "Total $48.00"
            ]
        );
        let summary = &blocks[1];
        assert_eq!((summary.x, summary.y), (40.0, 100.0));
        assert_eq!(summary.height, 68.0);
        assert_eq!(summary.width, 190.0);
    }

    #[test]
    fn two_columns_side_by_side_are_not_mixed() {
        let blocks = group_lines(vec![
            line("Left one", 20.0, 100.0, 100.0, 20.0),
            line("Right one", 400.0, 100.0, 100.0, 20.0),
            line("Left two", 20.0, 124.0, 100.0, 20.0),
            line("Right two", 400.0, 124.0, 100.0, 20.0),
        ]);
        let texts: Vec<&str> = blocks.iter().map(|b| b.text.as_str()).collect();
        assert_eq!(texts, ["Left one\nLeft two", "Right one\nRight two"]);
    }

    #[test]
    fn empty_lines_are_dropped_and_no_lines_means_no_blocks() {
        assert!(group_lines(vec![]).is_empty());
        assert!(group_lines(vec![line("   ", 0.0, 0.0, 10.0, 10.0)]).is_empty());
    }

    #[test]
    fn words_are_counted_across_lines() {
        assert_eq!(count_words("Order summary\nPro plan $42.00"), 5);
        assert_eq!(count_words(""), 0);
    }

    #[test]
    fn only_plain_web_addresses_may_be_opened() {
        for ok in [
            "https://lumengrab.app/docs/getting-started?ref=qr#install",
            "http://example.com",
            "https://sub.example.co.uk:8080/a%20b",
        ] {
            assert!(is_openable_link(ok), "{ok}");
        }
        for bad in [
            "",
            "javascript:alert(1)",
            "file:///etc/passwd",
            "ftp://example.com",
            "https://",
            "https://bank.com@evil.example/login",
            "https://exa mple.com",
            "https://example.com/\nsecond line",
            "mailto:a@b.c",
            "WIFI:T:WPA;S:Office;P:secret;;",
        ] {
            assert!(!is_openable_link(bad), "{bad}");
        }
        assert!(!is_openable_link(&format!(
            "https://example.com/{}",
            "a".repeat(MAX_LINK)
        )));
    }

    /// A real QR code of `data`, drawn module by module (the encoder is a test-only dependency).
    fn qr_frame(
        data: &str,
        module: usize,
        offset: (usize, usize),
        canvas: (usize, usize),
    ) -> Frame {
        let code = qrcode::QrCode::new(data.as_bytes()).unwrap();
        let n = code.width();
        let colors = code.to_colors();
        let mut rgba = vec![255u8; canvas.0 * canvas.1 * 4];
        for r in 0..n {
            for c in 0..n {
                if colors[r * n + c] != qrcode::Color::Dark {
                    continue;
                }
                for dy in 0..module {
                    for dx in 0..module {
                        let x = offset.0 + c * module + dx;
                        let y = offset.1 + r * module + dy;
                        let i = (y * canvas.0 + x) * 4;
                        rgba[i..i + 3].fill(0);
                    }
                }
            }
        }
        Frame {
            width: canvas.0 as u32,
            height: canvas.1 as u32,
            rgba,
        }
    }

    #[test]
    fn a_qr_code_is_read_with_its_text_and_where_it_sits() {
        let link = "https://lumengrab.app/docs/getting-started?ref=qr#install";
        let frame = qr_frame(link, 6, (120, 80), (600, 400));
        let codes = find_codes(&frame);
        assert_eq!(codes.len(), 1, "{codes:?}");
        assert_eq!(codes[0].value, link);
        // The box is around the drawn code (allowing for the finder patterns' own margin).
        assert!(
            (codes[0].x - 120.0).abs() < 20.0 && (codes[0].y - 80.0).abs() < 20.0,
            "{codes:?}"
        );
        assert!(codes[0].width > 100.0 && codes[0].x + codes[0].width <= 600.0);
    }

    #[test]
    fn two_codes_in_one_picture_are_both_read() {
        let mut one = qr_frame("WIFI:T:WPA;S:Office;P:secret;;", 5, (20, 20), (700, 300));
        let two = qr_frame("https://example.com/two", 5, (380, 40), (700, 300));
        for (a, b) in one
            .rgba
            .as_chunks_mut::<4>()
            .0
            .iter_mut()
            .zip(two.rgba.as_chunks::<4>().0.iter())
        {
            if b[0] == 0 {
                a[..3].fill(0);
            }
        }
        let mut values: Vec<String> = find_codes(&one).into_iter().map(|c| c.value).collect();
        values.sort();
        assert_eq!(
            values,
            ["WIFI:T:WPA;S:Office;P:secret;;", "https://example.com/two"]
        );
    }

    #[test]
    fn a_large_picture_is_searched_scaled_down_and_the_box_is_scaled_back() {
        let link = "https://example.com/large";
        let frame = qr_frame(link, 12, (1500, 900), (4000, 2600));
        let codes = find_codes(&frame);
        assert_eq!(codes.len(), 1);
        assert_eq!(codes[0].value, link);
        assert!(codes[0].x > 1300.0 && codes[0].x < 1700.0, "{codes:?}");
    }

    #[test]
    fn a_picture_without_a_code_has_none() {
        let blank = Frame {
            width: 200,
            height: 120,
            rgba: vec![255; 200 * 120 * 4],
        };
        assert!(find_codes(&blank).is_empty());
    }
}
