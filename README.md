# LumenGrab

A free screenshot and screen-recording app for **macOS and Windows**, with a built-in editor and a
presentation layer (backgrounds, padding, shadows, window frames) that turns plain screenshots into
presentation-ready visuals.

> **Status: early development.** Capture, Quick Access, the `.lumengrab` format and the editor (annotate, redact, crop, export) work;
> the presentation layer (backgrounds, frames, looks) is being finished; history, OCR and recording are still planned. Details: [docs/ROADMAP.md](docs/ROADMAP.md).

## Planned features

- Fast capture (area, window, fullscreen, later scrolling) via global hotkey
- Editor: crop, arrows, shapes, text, counters, highlighter, spotlight, blur / pixelate / solid redaction
- Presentation layer: gradient, mesh, image and blurred-screenshot backgrounds, padding with auto-balance, rounded corners, shadows, window frames, social media sizes, your own saved looks, and a default look for every new screenshot (animated backgrounds later)
- Our own single-file, editable format, **`.lumengrab`**: reopen any capture later and keep editing, with only that one file
  ([format spec](docs/FORMAT.md))
- History, pinned screenshots, local OCR (copy text, QR codes)
- Screen recording (MP4 / GIF)

Details and order: [docs/ROADMAP.md](docs/ROADMAP.md).

## Your files

Screenshots are saved as PNG in `Pictures/LumenGrab`. In the Quick Access card, **Save as…** can also write a
**`.lumengrab`** file: the untouched original plus everything needed to keep editing later, in one file
([format spec](docs/FORMAT.md)). Double-click a `.lumengrab` file (or use **Open Document…** in the menu bar / tray menu)
to open it in the editor. Files from a newer version open read-only instead of being damaged.

**The editor** (Quick Access **Edit**, or any `.lumengrab`): arrows, lines, shapes, text, counters, highlighter, pencil, spotlight,
blur / pixelate / solid redaction, crop, layers with groups, undo and redo. Export as PNG, JPG or WebP (at 0.5×, 1×, 2× or a custom
size), copy to the clipboard, or save a `.lumengrab`. Your work is autosaved to a recovery copy, and after a crash LumenGrab offers it back.

**Updates:** LumenGrab tells you when a new version is out (Settings > Updates, a card in the corner, the menu bar entry) and updates itself with one click; documents with unsaved changes ask first.

**Presentation** (the tab next to Annotate): a background (solid, gradient, mesh, your own picture or a blurred copy of the screenshot), padding (with auto-balance, and a button that trims too much empty space off the screenshot's own edges), rounded corners, a shadow,
a window frame and an aspect ratio (including Instagram, X, LinkedIn and other sizes at their exact pixels). Save a combination as **your look**, and choose a default look
that every new screenshot gets automatically (the saved file, the clipboard and drag-and-drop included; the original is kept for 30 days so you can still edit it).

A `.lumengrab` file contains the **unredacted original** by design (so it stays editable). Exports and previews are
always flat, with redactions baked in and the pixels destroyed.

## Privacy promise

- No accounts, no login, no telemetry.
- Everything (OCR, redaction, any AI-style feature) runs on your device.
- No network access except update checks and upload targets **you** configure yourself. The update check asks GitHub for one small file with the latest version number and sends nothing about you; you can turn the daily check off in Settings > Updates.
- No servers run by us. There is no backend and there never will be one.

## License

**Source available. Free for noncommercial use. Commercial use and reselling are not allowed.**

The source code is licensed under the [PolyForm Noncommercial License 1.0.0](LICENSE). This is
_source-available_, not OSI open source. The compiled app is free to use under the short
[terms of use](EULA.md). Third-party licenses are listed in [THIRD_PARTY_LICENSES](THIRD_PARTY_LICENSES).

The name **LumenGrab** and its logo are **not** licensed for reuse.

## Supported systems

- **macOS 14 (Sonoma) or newer.** Capture uses Apple's ScreenCaptureKit, which needs macOS 14.
- **Windows 10 or 11.** Capture uses Windows.Graphics.Capture; the exact minimum Windows 10 build is still being confirmed.

## Run it

Requirements: [Node.js](https://nodejs.org) (current LTS or newer), [pnpm](https://pnpm.io),
and for the native app the [Rust toolchain](https://rustup.rs) plus the
[Tauri prerequisites](https://tauri.app/start/prerequisites/) for your OS.
On macOS you also need the Swift toolchain (Xcode or the Command Line Tools), because the
ScreenCaptureKit bindings compile a small Swift bridge.

```sh
pnpm install
pnpm dev:web        # frontend in a plain browser with mocked platform calls (no Rust needed)
pnpm tauri dev      # full native app (tray icon; the window opens via the tray menu)
pnpm lint && pnpm typecheck && pnpm test
pnpm test:e2e       # Playwright UI tests (run in browser mock mode)
pnpm tauri build    # local installer build
```

LumenGrab lives in the menu bar (macOS) or system tray (Windows). Use the tray icon to reach Settings or Quit.

## First launch of unsigned builds

Release builds are currently **not code signed** (no paid certificates yet), so your OS will warn you the
first time. That is expected.

**macOS (Gatekeeper)**

1. Open the `.dmg` and drag LumenGrab to Applications.
2. Try to open it once. If macOS blocks it, go to **System Settings -> Privacy & Security**, scroll down and
   click **Open Anyway** next to LumenGrab. (Alternatively: right-click the app -> **Open**.)
3. If macOS says the app is "damaged", remove the download quarantine flag:
   `xattr -dr com.apple.quarantine /Applications/LumenGrab.app`
4. Capture will need **Screen Recording** permission (System Settings -> Privacy & Security -> Screen & System
   Audio Recording). After an update macOS may ask for it again.

**Windows (SmartScreen)**

Run the installer. If you see "Windows protected your PC", click **More info -> Run anyway**.

## Contributing

Pull requests are not accepted right now, see [CONTRIBUTING.md](CONTRIBUTING.md).
