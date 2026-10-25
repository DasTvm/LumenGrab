# ADR 0012: Reading text and QR codes from a picture

Status: accepted (M6). Designed in `LumenGrab.pen` ("M6 / Editor text", "M6 / Quick Access", "M6 / Text capture").

"Copy the text of this screenshot" must work without sending the picture anywhere and without installing a recogniser.

## Decisions

- **The operating system reads the text.** macOS: Vision (`VNRecognizeTextRequest`, accurate, language correction, automatic language) through `objc2-vision`. Windows: `Windows.Media.Ocr` through the `windows` crate, which needs an OCR language pack (a free Windows feature). The two sit behind one function, `platform::recognize_text(png, frame) -> Vec<Line>` (`platform/ocr_macos.rs`, `platform/ocr_windows.rs`); everything else (`src-tauri/src/ocr.rs`) is the same on both. Tesseract stays out: it is heavy and the system engines are good. It is the fallback to revisit if Windows language packs prove a problem.
- **A missing Windows language pack is a state, not a failure**: the command answers `NO_LANGUAGE_PACK`, and the editor, the Quick Access card and a notice all say so and open the Windows language settings.
- **Lines become blocks in Rust** (`group_lines`): neighbouring lines of one column become one block ("Order summary / Pro plan / Tax"), columns side by side stay apart. The boxes are in pixels of the picture, origin top-left (Vision's normalised bottom-left boxes are converted).
- **QR codes are read in Rust with `rqrr`** (MIT), on the same decoded picture, so Mac and Windows behave the same and the page needs no WebAssembly (the CSP stays as it is). Pictures larger than 2400 px on the long edge are scaled down for the search and the boxes scaled back. A code that cannot be decoded is skipped. (`qrcode`, a test-only dependency, draws real codes for the tests.)
- **The picture that is read is what the user would export**, never the original: the editor renders its own export without the presentation around it (crop, annotations and redactions baked in) and sends that. A redaction destroys the pixels, so redacted text cannot come back through "Copy text". The Text panel says so.
- **The page never sends a path.** The editor sends PNG bytes (raw request body, like the clipboard copy); the Quick Access card and the History send their entry id and Rust reads the file it owns.
- **QR links: copy always, open only after a question that shows the whole address.** Only `http` and `https` with a real host and no credentials in front of it (`is_openable_link`, mirrored in TypeScript `isWebLink`) are offered. The editor asks in its own dialog; a window without room (a Quick Access card, a notice) asks with a native dialog (`link_open_confirmed`). Other codes (Wi-Fi, plain text) can only be copied. `document::open_url` is not widened.
- **Where there is no window of ours** (the pin's menu, the text capture), `ocr::read_and_tell` answers with a card in the screen corner: "N words copied" (closes by itself), "No text found", "QR code found" with Copy / Open, or the error.
- **Slow work stays off the main thread** (`spawn_blocking`); a first read after start can take longer while the system loads its model.
- **No format change**, nothing is stored: the result lives in the panel until it is closed.
