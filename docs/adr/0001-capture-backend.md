# ADR 0001: Screen capture backend

Status: **macOS decided (ScreenCaptureKit), pending the minimum-macOS-14 OK. Windows provisional** until the spike has
been run on Windows hardware (see "Open gates").

## Context

M1 needs screen, window and area capture on macOS and Windows with correct multi-monitor and mixed-DPI behaviour.
AGENTS.md says to evaluate `xcap` and `scap` and to wrap the choice behind our own `Capturer` trait, so the
backend stays swappable. The spike in `tools/capture-spike` (standalone crate, not part of the app) compares the
candidates: on macOS `xcap` against ScreenCaptureKit, on Windows `xcap` with GDI against `xcap` with WGC.

Evidence is tagged: **[measured]** = run on the dev Mac (macOS 27.0, arm64, two displays: built-in 1920x1243 pt at 2x and an
external 2560x1440 pt at 2x with origin (-2560, -197)), **[source]** = read from library source or docs, **[pending]** = needs a run that has not
happened. Raw spike reports contain window titles of the developer's desktop and are therefore not committed.

## Candidates

|        | macOS                                                                                      | Windows                                              |
| ------ | ------------------------------------------------------------------------------------------ | ---------------------------------------------------- |
| A      | `xcap` 0.9.8 (Apache-2.0), uses `CGWindowListCreateImage`                                  | `xcap` default = GDI                                 |
| B      | `screencapturekit` 11.0.0 (MIT/Apache-2.0), `SCScreenshotManager`                          | `xcap` with `wgc` feature = Windows.Graphics.Capture |
| C      | `objc2-screen-capture-kit` 0.3.2 (raw bindings, not built)                                 | `windows-capture` 2.0.1 (MIT), not built             |
| `scap` | 0.1.0-beta.1 (Aug 2025), no push for 14 months, stream oriented: not considered for stills | same                                                 |

## Findings

### Pixel sizes and geometry

- **[measured] macOS, both backends:** captured sizes equal reported **points x scale** on both displays: 3840x2486 and 5120x2880. The built-in panel is
  2880x1864 running a scaled mode, so the image is the 2x backing store, larger than the panel (same as the system screenshot tool).
  100x100 pt region capture gives 200x200 px in both. The negative-origin display resolves correctly (`Monitor::from_point`).
- **[measured] ScreenCaptureKit default config returns 1920x1080** on both displays (wrong size and aspect), because no output size is set. The size must always be
  set from `SCShareableContentInfo::pixel_size()` (authoritative native size per filter); then it matches xcap exactly.
- **[measured] Colour agreement:** ScreenCaptureKit vs xcap full-display captures differ by a mean 0.59 per channel, with 2.5% of pixels differing by more than 8 (live screen content changing between the two captures). No colour shift or channel swap.
- xcap reports **points** on macOS (truncated to integers) and **physical pixels** on Windows; the captures themselves are physical pixels. The `Capturer` trait therefore exposes
  physical pixels + scale and hides this difference.
- **[source] xcap on Windows:** x/y/width/height come from `DEVMODE` (physical pixels). The scale factor is only reliable in a **per-monitor DPI aware** process
  (otherwise it falls back to `GetDeviceCaps`); the Tauri app is DPI aware and the spike sets it explicitly. [pending: run, also with `--no-dpi-awareness`]

### Permission behaviour (macOS)

- **[measured] xcap/CG without permission:** captures **succeed silently and return a blank single-colour image**, and only 2 windows are listed (vs 24 with permission). `CGPreflightScreenCaptureAccess()` works on macOS 27 (false without, true with permission).
  xcap gives no error, so we must always preflight; otherwise we would save a wallpaper-only file.
- **[measured] ScreenCaptureKit without permission:** `SCShareableContent::get()` fails with an explicit error ("user declined TCC for capture by apps, windows, displays"). Errors instead of blank images.
- Windows has no capture permission.

### Excluding our own overlay windows

- **Design:** we freeze all displays _before_ creating overlay windows, so frozen frames never contain overlays. Exclusion only matters for window-pick mode and as defence in depth.
- **[measured] ScreenCaptureKit:** excluding one window from a display capture (`with_excluding_windows`) makes it disappear: 99.9% of the pixels in that window's region differ from the unexcluded capture. First-class, works.
- **[source] xcap/CG:** the xcap API cannot exclude windows; the underlying call can (`...OnScreenBelowWindow`), but only by bypassing xcap.
- **[source] both OS, any backend:** Tauri's `set_content_protected(true)` maps to `WDA_EXCLUDEFROMCAPTURE` on Windows (tao source) and to the window sharing type on macOS (which newer macOS
  may ignore for ScreenCaptureKit). **Must be tested in Phase B**; not relied on alone.

### Window capture and the shadow question

- **[measured] xcap/CG macOS:** window images are **exactly bounds x scale and shadow-free** (alpha only at rounded corners). Good.
  But `Window::all()` returns everything on screen: of 24 entries several are not real windows (a display-sized Dock window about 94% transparent, fully transparent helper/overlay windows,
  a notification-centre window). xcap exposes **no window layer**, so a window picker would have to guess with size/transparency heuristics.
- **[measured] ScreenCaptureKit:** `SCWindow` has `window_layer()` and `is_on_screen()`; filtering `layer == 0 && on screen && titled` leaves only real windows.
  Shadows: with `with_ignores_shadows_single_window(true)` the image is **exactly frame x scale, shadow-free** (same as xcap). With the default (shadow kept) the same pixel size is used, so the
  window is **shrunk to make room for the shadow** (about 4 px inset, 6-11% semi-transparent pixels): it loses resolution and alignment. We want no shadow (the presentation layer, M5, adds our own),
  so `ignores_shadows_single_window(true)` is mandatory.
- **[source] Windows GDI:** `PrintWindow` based. **WGC:** captures the window item only (no overlapping windows). Invisible DWM border behaviour [pending: Windows run].

### Speed

- **[measured] xcap/CG macOS:** warm median **47 ms** (3840x2486) and **62 ms** (5120x2880); cold 116 / 94 ms.
- **[measured] ScreenCaptureKit:** `capture_image` alone **48 ms** and **57 ms** (parity with xcap). The crate's `rgba_data()` conversion adds 34 / 54 ms, while `bgra_data()` costs **2 ms**: read BGRA and swizzle in the encoder or
  on the fly (this explains why a naive run looked about 2x slower). Cold first capture 87 / 123 ms. Capturing displays in parallel threads is possible.
- **[measured] PNG encode of a real 5120x2880 frame:** default **515 ms** (2.6 MB), fast + Sub filter **20 ms** (3.9 MB), fast + no filter 63 ms (56 MB, effectively uncompressed).
  Decision: serve frozen frames to the overlay with **fast + Sub (20 ms)**; encode the saved file with the default level **off the critical path** (background thread).
- **[pending]** Windows GDI and WGC timings. **[source]** xcap's WGC path creates a frame pool per capture and waits for the first frame (3 s timeout), so expect more latency than GDI's single `BitBlt`.

### Code and dependency cost

| Backend                  | Adapter code (est.)                                                                            | Extra build requirements                                                                                                                                                                                                                                                       | Dependencies                                                                                                      |
| ------------------------ | ---------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ----------------------------------------------------------------------------------------------------------------- |
| xcap (macOS and Windows) | ~60 lines for list/capture displays + windows; one dependency for both OS                      | none                                                                                                                                                                                                                                                                           | 62 crates on macOS (mostly `image` and `objc2-*`), all permissive                                                 |
| screencapturekit (macOS) | ~100 lines (filters, configs, BGRA readback, window filter) + 1 `build.rs` line                | **Swift toolchain at build time** (Xcode CLT; present on macOS CI runners); needs `-rpath /usr/lib/swift` or the binary fails at launch with `Library not loaded: @rpath/libswift_Concurrency.dylib` **[measured]**; links the system Swift runtime (shipped with macOS 12.3+) | 12 crates, all MIT/Apache-2.0, 288 KB Swift bridge; maintained by one author (doom-fish), last release 2026-09-24 |
| objc2-screen-capture-kit | more (hand-written block/completion-handler glue, no Swift)                                    | none                                                                                                                                                                                                                                                                           | raw bindings only; Zlib/Apache/MIT [not built]                                                                    |
| windows-capture          | more than xcap for single frames: its model is a callback handler built for continuous capture | none                                                                                                                                                                                                                                                                           | MIT; a good candidate for M7 recording rather than stills                                                         |

Minimum macOS version: `SCScreenshotManager` stills need **macOS 14** (we do not need the 15.2 rect API: we crop frozen frames ourselves). Tauri's default minimum is
older; choosing ScreenCaptureKit means `minimumSystemVersion` 14.0 in `tauri.conf.json` and saying so in the README.

### Other facts worth keeping

- **[source]** xcap macOS window list is front-to-back and on-screen only; minimized windows are not listed (upstream #205).
- **[source]** xcap's Windows `wgc` path turns off the cursor and, best effort, the yellow capture border (needs Windows 11 / capability).
  WGC needs roughly Windows 10 1903+; the GDI path has open issue reports of white or blank captures on Win11 (#130) and of game frames (#131) [issue reports, not reproduced].
- **[source]** Open xcap issues of note: ScreenCaptureKit switch (#253), memory leak on M4 (#203), hang (#209), colour difference (#210), no HDR (#270).
- The spike's "window vs display crop" comparison picked a transparent helper window and is inconclusive; not used for any decision.

## Decision

- **macOS: ScreenCaptureKit via `screencapturekit`, minimum macOS 14.** Verified on macOS 27: correct sizes (when sized from the filter), equal speed (via BGRA), matching colours, working window exclusion,
  shadow control, window layer filtering, explicit permission errors. xcap/CG also works technically on 27 but silently returns blank images without permission, cannot exclude windows and exposes no window layer,
  and its own tracker asks for the same switch. Rules for the implementation:
  1. Always set output width/height from `pixel_size()`.
  2. Read **BGRA**, not RGBA.
  3. Window capture: `ignores_shadows_single_window(true)`; list windows with `layer == 0 && is_on_screen`.
  4. Add `-rpath /usr/lib/swift` in `src-tauri/build.rs`; document the Swift toolchain in README/CI.
  5. Treat a failing `SCShareableContent::get()` or `CGPreflightScreenCaptureAccess() == false` as "permission missing" and show the permission window.
- **Windows (provisional): `xcap` with the `wgc` feature**, GDI kept as the documented fallback (a Cargo feature, not a runtime switch): a thin WGC wrapper behind the same API, no cursor/border in the image,
  avoids the GDI blank-capture reports. `windows-capture` stays the alternative if xcap's per-capture frame pool is too slow or limiting (and is the likely M7 recording base).
- **Both behind our `Capturer` trait**, which exposes physical pixels + scale and never points, plus a `Window` type that already contains only real, capturable windows. Swapping a backend must not touch anything above the trait.

## Open gates

1. **Windows run** of the spike (default and `--features wgc`), ideally on a mixed-DPI setup: sizes, speed, content (no white frames), window capture size, DPI-unaware comparison. If WGC is clean it is the default;
   if both show problems, evaluate `windows-capture`.
2. **Overlay exclusion on both OS** with `set_content_protected(true)`: Phase B test.
3. **Minimum macOS 14** acceptable to the user.
4. A true **mixed-scale** macOS setup (1x + 2x, fractional) is not available on the dev Mac (both displays are 2x); covered by the manual checklist.

## Consequences

- The `Capturer` trait and the thin `platform/{macos,windows}` split from the M1 plan are unchanged; only the macOS implementation behind the trait is ScreenCaptureKit instead of xcap.
- Phase B adds the rpath line to `src-tauri/build.rs`, a Swift toolchain note to README/CI, and `minimumSystemVersion`.
- `tools/capture-spike` stays as a diagnostic until the Windows decision is final, then can be deleted or kept.
