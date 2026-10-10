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
- [ ] **M1 Capture MVP**: Hotkey, area, window and fullscreen, save and clipboard, multi-monitor.
  - Status: building.
  - [x] Global hotkey and the capture bar
  - [x] Area and window selection
  - [x] Fullscreen capture
  - [x] Save to file and copy to clipboard
  - [ ] Multi-monitor and mixed DPI, tested on real setups
- [ ] **M2 Quick Access overlay**: Copy, save, edit, drag out, auto-close.
  - Status: building.
  - [x] Card in a screen corner after each capture
  - [x] Auto-close and corner setting
  - [x] Drag the screenshot out
  - [x] Large preview with delete and undo
  - [ ] Edit opens the editor, arrives with M4
- [ ] **M3 Document and .lumengrab format**: Schemas, read and write, migrations, file association.
  - Status: next.
  - [ ] Document schemas and ZIP container
  - [ ] Read and write with validation
  - [ ] Migrations and golden fixtures
  - [ ] Preview rendering
  - [ ] File association
- [ ] **M4 Editor**: Crop, annotations, redactions, undo and export.
  - Status: planned.
  - [ ] Crop and resize
  - [ ] Annotation tools
  - [ ] Permanent redactions in flat exports
  - [ ] Undo and redo
  - [ ] PNG, JPG and WebP export
- [ ] **M5 Presentation**: Backgrounds, padding, shadows and window frames.
  - Status: planned.
  - [ ] Backgrounds and saved presets
  - [ ] Padding, radius and shadows
  - [ ] Aspect presets
  - [ ] Window frames
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

Later: Video editor with smart zooms, Device mockups, 3D tilt, Local auto-redact, Multi-format export, Upload targets you set up.
