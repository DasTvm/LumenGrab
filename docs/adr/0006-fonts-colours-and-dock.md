# ADR 0006: Fonts, colours and the Dock (M4 follow-up)

Status: accepted. Spec: [`docs/FORMAT.md`](../FORMAT.md) section 8.

## Decisions

- **Eight bundled fonts, plus the device's fonts.** Inter, JetBrains Mono, Lora, Fraunces, Space Grotesk, Oswald, Nunito and Caveat ship with the app (variable
  fonts, SIL OFL-1.1, `@fontsource-variable`). A text layer may also use a font installed on the device: `fontId: "system:<family>"`. This relaxes the old rule "no
  system-font dependency inside files" on purpose: the file stores only the name, never the font (no licence problem), falls back to Inter where the font is
  missing (the editor says so), and flat exports are always made on the device that has the font. No schema change: `fontId` was already a free string, so
  the format version stays 2. The list of installed fonts comes from Rust (`fontdb`, MIT), because the macOS WebView has no `queryLocalFonts`.
- **Our own colour picker.** The system `<input type=color>` differs per OS and does nothing in the macOS WebView. The picker (square, hue, hex field, eyedropper
  where the engine has `EyeDropper`) is in the design language of the app. Saved colours live in the WebView's local storage, which all windows share
  (no Rust change, no write races with the settings file); they are swatches in every colour row.
- **A real app while a window is open (macOS).** LumenGrab is a menu bar app (activation policy `Accessory`: no Dock icon, not in Cmd+Tab). While an editor, the
  settings or the recovery window is open it switches to `Regular`, and back when the last such window closes (`platform::update_dock_presence`). Overlays and
  Quick Access cards are not "work" windows and never change it.
