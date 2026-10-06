# ADR 0001: Screen capture backend

Status: **DRAFT.** Provisional recommendation. The macOS content tests are blocked on Screen Recording permission
and the Windows runs have not happened yet (see "Open gates"). Do not treat the decision as final.

## Context

M1 needs screen, window and area capture on macOS and Windows with correct multi-monitor and mixed-DPI behaviour.
AGENTS.md says to evaluate `xcap` and `scap` and to wrap the choice behind our own `Capturer` trait, so the
backend stays swappable. The spike in `tools/capture-spike` (standalone crate, not part of the app) compares the
candidates. It was extended on request to also test ScreenCaptureKit on macOS and GDI vs WGC on Windows.

Evidence is tagged: **[measured]** = run on the dev Mac (macOS 27.0, arm64, two displays), **[source]** = read from
the library source or its docs, **[pending]** = needs a run that has not happened.

Caveat for every macOS number below: the run had **no Screen Recording permission**. Sizes, speed and permission
behaviour are valid; anything about image _content_ is not.

## Candidates

|        | macOS                                                                                      | Windows                                              |
| ------ | ------------------------------------------------------------------------------------------ | ---------------------------------------------------- |
| A      | `xcap` 0.9.8 (Apache-2.0), uses `CGWindowListCreateImage`                                  | `xcap` default = GDI                                 |
| B      | `screencapturekit` 11.0.0 (MIT/Apache-2.0), `SCScreenshotManager`                          | `xcap` with `wgc` feature = Windows.Graphics.Capture |
| C      | `objc2-screen-capture-kit` 0.3.2 (raw bindings, not built)                                 | `windows-capture` 2.0.1 (MIT), not built             |
| `scap` | 0.1.0-beta.1 (Aug 2025), no push for 14 months, stream oriented: not considered for stills | same                                                 |

## Findings

### Geometry and pixel sizes

- **[measured] xcap on macOS:** sizes are correct on both displays. Built-in: 1920x1243 points x 2.0 = **3840x2486** px
  (the panel is 2880x1864 running a scaled mode, so the image is the 2x backing store, larger than the panel).
  External: 2560x1440 pt x 2.0 = 5120x2880 at origin **(-2560, -197)**, i.e. a negative origin. 100x100 pt region capture
  gives 200x200 px. `Monitor::from_point` resolves both displays correctly.
  xcap reports **points** on macOS (truncated to integers) and **physical pixels** on Windows; the capture itself is
  physical pixels. The `Capturer` trait must therefore expose physical pixels + scale and hide this.
- **[source] xcap on Windows:** x/y/width/height come from `DEVMODE` (physical pixels). The scale factor is only reliable
  in a **per-monitor DPI aware** process (otherwise it falls back to `GetDeviceCaps`). The Tauri app is DPI aware;
  the spike sets it explicitly. The `--no-dpi-awareness` flag shows the difference. [pending]
- **[source] ScreenCaptureKit:** `SCShareableContentInfo::for_filter` gives `point_pixel_scale` and `pixel_size`, an authoritative native
  pixel size per filter, so we do not compute it ourselves. Whether the default config (no width/height) returns native
  pixels or point size [pending].

### Permission behaviour (macOS)

- **[measured] xcap/CG without permission:** `CGPreflightScreenCaptureAccess()` works on macOS 27 (returned `false`, no crash). Captures
  **succeed silently and return a blank single-colour image**, and the window list shows only 2 windows. So xcap gives no
  error: we must always preflight ourselves, otherwise we would save a wallpaper-only file.
- **[measured] ScreenCaptureKit without permission:** `SCShareableContent::get()` fails with an explicit error ("Content
  unavailable: user declined TCC for capture by apps, windows, displays", shown in the system language). Errors instead of blank images, and
  a failing call is the permission check.
- Windows has no capture permission.

### Excluding our own overlay windows

- **Design:** we freeze all displays _before_ creating overlay windows, so the frozen frames never contain overlays. Exclusion
  only matters for window-pick mode and for defence in depth.
- **[source] macOS xcap/CG:** the xcap API cannot exclude windows. The underlying call can (`...OnScreenBelowWindow`), but only by bypassing xcap.
- **[source] macOS ScreenCaptureKit:** first-class (`with_excluding_windows`, `with_excluding_applications`). The spike has a
  demo that diffs a display capture with and without one window excluded [pending: needs permission].
- **[source] Both OS, any backend:** Tauri's `set_content_protected(true)` maps to `WDA_EXCLUDEFROMCAPTURE` on Windows
  (tao source) and to the window sharing type on macOS. Windows: documented to hide the window from all capture. macOS:
  newer macOS versions may ignore the sharing type for ScreenCaptureKit; **must be tested in Phase B** [pending].

### Window capture, with and without shadow

- **[source] macOS xcap/CG:** window images use default options, so the shadow is included and cannot be turned off through xcap.
  The spike table shows bounds vs captured size [pending: needs permission].
- **[source] macOS ScreenCaptureKit:** `SCStreamConfiguration::with_ignores_shadows_single_window(bool)` (macOS 14+). The spike
  captures each candidate window with shadows kept and ignored and prints both sizes [pending].
  We want no shadow: the presentation layer (M5) adds our own.
- **[source] Windows GDI:** `PrintWindow` based. **WGC:** captures the window item only (no overlapping windows), sized by the capture item.
  Invisible DWM border behaviour [pending: Windows run].

### Speed

- **[measured] xcap/CG macOS:** warm median **20 ms** (3840x2486) and **46 ms** (5120x2880), cold 95 ms and 39 ms.
- **[pending]** ScreenCaptureKit timings (needs permission); Windows GDI and WGC timings.
- **[measured, not valid]** PNG encode cost was measured on _blank_ frames (too compressible), so the numbers (7 ms fast vs 67 ms
  default) say nothing; re-run with permission to decide how frozen frames are served to the overlay.
- **[source] xcap WGC:** creates a frame pool per capture and waits for the first frame (3 s timeout); expect more latency than
  GDI's single `BitBlt`, to be measured. Displays can be captured in parallel threads.

### Code and dependency cost

| Backend                  | Adapter code (est.)                                                                            | Extra build requirements                                                                                                                                                                                                                                                       | Dependencies                                                                                                      |
| ------------------------ | ---------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ----------------------------------------------------------------------------------------------------------------- |
| xcap (macOS and Windows) | ~60 lines for list/capture displays + windows; one dependency for both OS                      | none                                                                                                                                                                                                                                                                           | 62 crates on macOS (mostly `image` and `objc2-*`), all permissive                                                 |
| screencapturekit (macOS) | ~100 lines (filters, configs, RGBA readback) + 1 `build.rs` line                               | **Swift toolchain at build time** (Xcode CLT; present on macOS CI runners); needs `-rpath /usr/lib/swift` or the binary fails at launch with `Library not loaded: @rpath/libswift_Concurrency.dylib` **[measured]**; links the system Swift runtime (shipped with macOS 12.3+) | 12 crates, all MIT/Apache-2.0, 288 KB Swift bridge; maintained by one author (doom-fish), last release 2026-09-24 |
| objc2-screen-capture-kit | more (hand-written block/completion-handler glue, no Swift)                                    | none                                                                                                                                                                                                                                                                           | raw bindings only; Zlib/Apache/MIT [not built]                                                                    |
| windows-capture          | more than xcap for single frames: its model is a callback handler built for continuous capture | none                                                                                                                                                                                                                                                                           | MIT; a good candidate for M7 recording rather than stills                                                         |

Minimum macOS version: `SCScreenshotManager` stills need **macOS 14**, capture-in-rect **15.2**. Tauri's default minimum is
older; choosing ScreenCaptureKit means setting `minimumSystemVersion` to 14.0 and saying so in the README.

### Other facts worth keeping

- **[source]** xcap macOS window list is front-to-back and on-screen only; minimized windows are not listed (upstream #205).
  ScreenCaptureKit can list off-screen windows too (`is_on_screen` flag).
- **[source]** xcap's Windows `wgc` path turns off the cursor and, best effort, the yellow capture border (needs Windows 11 / capability).
  WGC needs roughly Windows 10 1903+; the GDI path has open issue reports of white or blank captures on Win11 (#130) and of game frames (#131) [issue reports, not reproduced].
- **[source]** Open xcap issues of note: ScreenCaptureKit switch (#253), memory leak on M4 (#203), hang (#209), colour difference (#210), no HDR (#270).

## Recommendation (provisional)

- **macOS: ScreenCaptureKit via `screencapturekit`**, minimum macOS 14. Reasons: it is Apple's supported API (the CG one is
  deprecated, and xcap's own tracker asks to replace it), it errors on missing permission instead of returning blank frames,
  it has built-in window exclusion and shadow control, and it gives authoritative pixel sizes. Costs: Swift toolchain at build time,
  one rpath line, a single-maintainer crate. Keep xcap/CG out of M1 unless the permission-enabled run shows a ScreenCaptureKit problem
  (two macOS backends would double maintenance).
- **Windows: `xcap` with the `wgc` feature**, GDI kept as the documented fallback (a Cargo feature, not a runtime switch).
  Reasons: it is a thin WGC wrapper behind the same API we use on macOS, has no cursor/border in the image, avoids the GDI blank-capture reports.
  `windows-capture` stays the alternative if xcap's per-capture frame pool is too slow or limiting (and is the likely M7 recording base).
- **Both behind our `Capturer` trait**, which exposes physical pixels + scale and never points. Swapping a backend must not touch anything above the trait.

## Open gates (what flips or confirms the recommendation)

1. **macOS content run with permission** (see below): ScreenCaptureKit pixel sizes, speed, shadow sizes, exclusion demo, content diff vs xcap
   (colour correctness). If ScreenCaptureKit is slow (>~150 ms per display) or sizes are wrong, revisit.
2. **Windows run** of the spike, default and `--features wgc`: sizes in a mixed-DPI setup, speed, content (no white frames), window capture size.
   If WGC is clean, it is the default; if GDI shows the white-frame bug and WGC does too, evaluate `windows-capture`.
3. **Overlay exclusion on both OS** with `set_content_protected(true)`: Phase B test, must not rely on it alone.
4. **Minimum macOS version 14** acceptable to the user.

### Which app needs the macOS permission

The shell chain is `MonoCode.app -> claude -> zsh -> capture-spike`, so **MonoCode** (`/Applications/MonoCode.app`) is the app
that needs **Screen Recording** (System Settings -> Privacy & Security -> Screen & System Audio Recording). Enable it, then quit and reopen MonoCode
(the permission only applies to processes started afterwards) and start a new session.

## Consequences

- The `Capturer` trait and a thin `platform/{macos,windows}` split are unchanged from the M1 plan; only the macOS implementation behind it changes.
- Phase B adds the rpath line to `src-tauri/build.rs` and a Swift toolchain requirement to the README and CI (macOS runners have it).
- `tools/capture-spike` stays as a diagnostic until the decision is final, then can be deleted or kept.
