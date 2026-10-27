# ADR 0013: All-in-one capture and Text capture

Status: accepted (M6). Designed in `LumenGrab.pen` ("M6 / All-in-one", "M6 / Text capture").

The capture bar offered Area and Window as two modes with different hands: drag or click. Most people just want to point at what they mean.

## Decisions

- **All-in-one is a mode of the same overlay** (`CaptureMode::AllInOne`, `"allinone"`): the window under the pointer is outlined and named, a click takes it, a drag takes an area (a movement under 4 px is still a click), Tab / Enter work for windows, `F` takes the display. Area and Window stay as pure modes. It is the default of a **new install** (`DefaultMode::AllInOne`); a `settings.json` that already holds a choice keeps it.
- **A capture remembers where it came from**: a capture taken in all-in-one is listed in the History under "All-in-one", whether it was a window or an area.
- **Repeat the last area**: the size of the last selected area (area, all-in-one or text) is kept in `capture_state.json` in the config folder, in **logical pixels**, so it means the same on a 1x and a 2x display. It is **not shown by itself** (an outline on every capture looked like a selection that is already there and made people unsure whether they could draw a new one). `R` (or "Repeat last" in the bar) switches it on: a dashed outline of that size follows the pointer, a click takes it centred on the pointer (kept on the display), `R` again switches it off. The click's own pointer position is used, not the last drawn one. It is app state, not a setting.
- **Text capture** (`CaptureMode::Text`, bar segment "Text", key `T`, Ctrl+Shift+T, tray "Capture Text") is the same area drag, but the result is the _words_: the area is read (ADR 0012), the text goes to the clipboard, and a card in the corner says so. **No file is saved and no Quick Access card shows the picture.** Settings > History > "Keep a picture of text captures" (off by default) decides whether the history gets a copy of the picture. A window cannot be picked in Text mode.
- **Scroll is a placeholder** ("Soon", disabled) for M8, so the bar does not change shape then.
- **The native side decides what a submission means.** The overlay only sends an area or a window; `flow::submit_area` looks at the live mode of the session (switching the mode on one display switches all of them), so the page cannot ask for a text read in a way the bar did not offer.
