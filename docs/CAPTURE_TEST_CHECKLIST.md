# Capture test checklist: multi-monitor and mixed DPI

Manual tests for M1 (capture MVP). Run them on your own hardware; nothing here can be verified in CI.
Hotkeys: **Ctrl+Shift+4** area, **Ctrl+Shift+5** window, **Ctrl+Shift+3** fullscreen (both OS).

**How to report:** one row per setup: machine, OS version, monitors (resolution, scale %, arrangement), result per
section, notes, screenshot. Attach the spike reports from `tools/capture-spike` (see its README; on Windows run
it twice: default and `--features wgc`).

## Expected output size (read this first)

- **macOS:** image size = reported **points x scale** (the HiDPI backing store). In a scaled display mode this is
  **larger than the panel's physical pixels**: a 2880x1864 panel running "looks like 1920x1243" gives
  **3840x2486**. That is also what the system screenshot tool produces. It is not an error.
- **Windows:** image size = the monitor's **physical pixels** (per-monitor DPI aware process).

## Setups to cover (as many as you have)

- macOS: single Retina; Retina + external at a different scale (1x and 2x, plus a scaled mode); external **left of
  / above** the primary (negative coordinates; the dev Mac already has one at x=-2560); different heights and top offsets.
- Windows: laptop 150% + external 100%; two or three monitors at 100/125/150/200%; secondary left of primary;
  portrait (rotated) monitor; taskbar on a non-bottom edge.

## 1. Spike sanity (each setup)

- Reported monitor sizes and scales match System Settings / Display Settings.
- Every captured image size equals the expected size above.
- Windows only: also run once with `--no-dpi-awareness` and note how the numbers change (explains why the app must be DPI aware).

## 2. Fullscreen (Ctrl+Shift+3)

- With the cursor on each monitor in turn, the captured image is that monitor.
- Size as expected; sharp (no blur or upscale); colours right (check a known swatch: no red/blue swap, no tint).
- File appears in the folder, filename unique on rapid repeats.
- Pasting from the clipboard (Preview/Paint/Slack) gives the identical image. No cursor in the image.

## 3. Area (Ctrl+Shift+4)

- Overlays appear on **all** monitors at once; frozen content matches the live screen exactly (no shift, no scaling, no ghost of the overlay).
- Drag 400x300 on each monitor: output is 400·scale x 300·scale px (800x600 at 2x, 600x450 at 1.5x). Edges are
  pixel-accurate: compare with a full-screen grid/ruler image, check the first and last row/column.
- Selections at the exact edges and corners of each monitor and near the seam between monitors.
- Dragging past the monitor edge clamps to that monitor; dragging into another monitor does not cross.
- Esc cancels on every monitor and saves nothing; a click without drag cancels; a tiny drag (<5 px) is ignored.
- The live size readout shows output pixels.

## 4. Window (Ctrl+Shift+5)

- Hover highlight matches the real window frame on each monitor; the front window wins when overlapping; windows partly off-screen; a window **straddling two monitors with different scales**.
- Click captures only that window (overlapping windows are not in the image); sharp at that monitor's scale.
- Minimized windows are not offered; a fullscreen app window works.
- macOS: note whether the shadow is included and the resulting size. Windows: no invisible 7 px border or blank margin; a browser with video, GPU-accelerated and UWP windows are not black or white.

## 5. Hotkeys and sessions

- Work with any other app focused and with a fullscreen app.
- Holding the key does not open multiple overlays; pressing another capture hotkey during an overlay is ignored.
- If the key is already taken by another app you get a clear message and the tray menu still works.

## 6. Overlay behaviour

- Covers menu bar/Dock/taskbar and fullscreen apps; crosshair cursor.
- No Dock icon (macOS) and no taskbar button for overlays (Windows).
- Focus returns to the previous app after finish or cancel; works across Spaces/virtual desktops.
- Record the time from hotkey to overlay visible.
- The overlay never appears in the captured image (also when a capture is triggered while another overlay is closing).

## 7. Display changes

- Plug/unplug a monitor, change resolution or scale, rearrange monitors, sleep/wake, lock screen: the next capture uses the new layout, no stale or offset overlays, no crash.

## 8. macOS permission

- First run without permission shows the friendly window (no wallpaper-only file saved).
- After granting and restarting, capture works; denied state; permission revoked while running.
- After installing a **new unsigned build** over an old one, follow the on-screen remove-and-re-add hint and confirm it recovers.

## 9. Stability

- 20 captures in a row: memory stable, no leftover overlay windows.
- Idle CPU is about 0 in the tray; Quit from the tray exits cleanly and the hotkeys are released.

## 10. Output files

- PNG opens everywhere, fully opaque, correct orientation on a rotated monitor.
- The folder is created if missing; a read-only or missing Pictures folder produces an error dialog and the clipboard copy still happens.
