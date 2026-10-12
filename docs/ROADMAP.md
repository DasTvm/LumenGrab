# Roadmap

Work happens in small milestones. A milestone is done once it is finished and tested.

Generated from [website-roadmap.json](website-roadmap.json). Edit that file, then run `node scripts/website/roadmap-markdown.mjs`.

- [x] **M0 Scaffold**: App shell, tests, CI and the tray icon.
  - Status: done; finished 2026-10-06.
  - [x] App shell and browser mock mode
  - [x] Design tokens and core UI
  - [x] Unit and screenshot tests
  - [x] Checks for macOS and Windows
  - [x] Tray icon
- [x] **M1 Capture MVP**: Hotkey, area, window and fullscreen, save and clipboard, multi-monitor.
  - Status: done; finished 2026-10-11.
  - [x] Global hotkey and the capture bar
  - [x] Area and window selection
  - [x] Fullscreen capture
  - [x] Save to file and copy to clipboard
  - [x] Multi-monitor and mixed DPI, tested on real setups
- [x] **M2 Quick Access overlay**: Copy, save, edit, drag out, auto-close.
  - Status: done; finished 2026-10-11.
  - [x] Card in a screen corner after each capture
  - [x] Auto-close and corner setting
  - [x] Drag the screenshot out
  - [x] Large preview with delete and undo
  - [x] Edit opens the editor
- [x] **M3 Document and .lumengrab format**: Schemas, read and write, migrations, file association.
  - Status: done; finished 2026-10-10.
  - [x] Document schemas and ZIP container
  - [x] Read and write with validation
  - [x] Migrations and golden fixtures
  - [x] Preview rendering
  - [x] File association
- [ ] **M4 Editor**: Crop, annotations, redactions, undo and export.
  - Status: building.
  - [x] Crop and resize
  - [x] Annotation tools
  - [x] Permanent redactions in flat exports
  - [x] Undo and redo
  - [x] PNG, JPG and WebP export
  - [ ] Complete native editor acceptance checks on macOS and Windows
- [ ] **M5 Presentation**: Backgrounds, padding, shadows, window frames, social formats and a default look for every new screenshot.
  - Status: building.
  - [x] File format v3 and fixed rendering rules for presentation
  - [x] Backgrounds: solid, gradient, mesh, own image and blurred screenshot
  - [x] Padding, auto-balance, corner radius and shadows
  - [x] Window frames: macOS, Windows, browser, minimal and terminal
  - [x] Aspect ratios and social media formats
  - [x] Looks: built-in gallery and your own saved looks
  - [x] Default look for every new screenshot, set in Settings
  - [ ] Complete native presentation acceptance checks on macOS and Windows
- [ ] **M6 History, pin and OCR**: History, pinned captures, copy text, QR, all-in-one mode.
  - Status: planned.
  - [ ] Capture history
  - [ ] Pinned captures
  - [ ] Local text and QR recognition
  - [ ] All-in-one capture mode
- [ ] **M7 Screen recording**: MP4 and GIF with audio and click or key overlays.
  - Status: planned.
  - [ ] MP4 and GIF recording
  - [ ] Microphone and system audio
  - [ ] Click and keystroke overlays
- [ ] **M8 Scrolling capture**: Capture a whole page or a long chat in one go.
  - Status: planned.
  - [ ] Long-page capture
  - [ ] Long-chat capture
  - [ ] Stitching and export

Later: Animated backgrounds, exported as video, Video editor with smart zooms, Device mockups, 3D tilt, Local auto-redact, Multi-format export, Upload targets you set up.
