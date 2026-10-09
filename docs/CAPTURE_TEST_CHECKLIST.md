# Capture test checklist: multi-monitor and mixed DPI

Manual tests for M1 (capture MVP). Run them on your own hardware; nothing here can be verified in CI.
Hotkeys (both OS): **Ctrl+Shift+1** is the main one (capture bar, starts in the default mode from Settings > General).
The quick picks start straight in one mode, without the bar: **Ctrl+Shift+4** area, **Ctrl+Shift+5** window, **Ctrl+Shift+3** fullscreen.

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
- Esc cancels (also when the overlay has no keyboard focus: Esc is grabbed globally during a capture) and saves nothing; right click cancels; a click without drag or a tiny drag (<5 px) is ignored and you can keep selecting.
- The live size readout shows output pixels.

## 4. Window (Ctrl+Shift+5)

- Hover highlight matches the real window frame on each monitor; the front window wins when overlapping; windows partly off-screen; a window **straddling two monitors with different scales**.
- Click captures only that window (overlapping windows are not in the image); sharp at that monitor's scale.
- Minimized windows are not offered; a fullscreen app window works. The picker never highlights the Dock, menu bar, notification banners or invisible helper/overlay windows.
- macOS: note whether the shadow is included and the resulting size. Windows: no invisible 7 px border or blank margin; a browser with video, GPU-accelerated and UWP windows are not black or white.

## 4b. Capture bar (Ctrl+Shift+1), several displays

- The bar and the hint show on **one** display only (the one under the cursor at the start); the others show just the dimmed frame.
- Switch to Window with the bar (or key W) and move to another display: windows highlight there too. Switch back to Area: dragging works on every display.
- Keys A / W / F work with the pointer on any display (F captures the display under the pointer).
- Settings > General > Default capture mode: switch to Window, press Ctrl+Shift+1: starts in window mode. Restart LumenGrab: the choice is kept.
- The quick picks (4 / 5) show no bar, and A / W / F do nothing there.

## 5. Hotkeys and sessions

- Work with any other app focused and with a fullscreen app.
- Holding the key does not open multiple overlays; pressing another capture hotkey during an overlay is ignored.
- If the key is already taken by another app you get a clear message and the tray menu still works.

## 6. Overlay behaviour

- **Regression, must pass first:** start an area capture, press **Esc**: the overlays disappear immediately and the Mac stays responsive (the first test build froze here). Repeat 10 times, also pressing Esc right after the overlays appear, and once with the mouse on each display.
- Window mode: move the pointer to the **second display**: its windows highlight on hover and a click captures that window. Then back to the first display.
- If the app ever stops responding while an overlay is up, it exits by itself after about 4 seconds (watchdog); please tell me when that happens.
- Tray menu "Open Screenshots Folder" opens `Pictures/LumenGrab`; after a capture the menu bar icon shows "Saved" for 2 s (macOS).

- Covers menu bar/Dock/taskbar and fullscreen apps; crosshair cursor.
- No Dock icon (macOS) and no taskbar button for overlays (Windows).
- Focus returns to the previous app after finish or cancel; works across Spaces/virtual desktops.
- Record the time from hotkey to overlay visible.
- The overlay never appears in the captured image (also when a capture is triggered while another overlay is closing).

## 7. Display changes

- Plug/unplug a monitor, change resolution or scale, rearrange monitors, sleep/wake, lock screen: the next capture uses the new layout, no stale or offset overlays, no crash.

## 8. macOS permission

- Test builds signed with the local certificate (see AGENTS.md) keep the permission across rebuilds. Ad-hoc builds lose it every time: the dialog appears although LumenGrab is switched on in System Settings. Fix: remove LumenGrab with the minus button, add it again, quit and reopen it.

- First run without permission shows the friendly window (no wallpaper-only file saved).
- After granting and restarting, capture works; denied state; permission revoked while running.
- After installing a **new unsigned build** over an old one, follow the on-screen remove-and-re-add hint and confirm it recovers.

## 9. Stability

- 20 captures in a row: memory stable, no leftover overlay windows.
- Idle CPU is about 0 in the tray; Quit from the tray exits cleanly and the hotkeys are released.

## 10. Output files

- PNG opens everywhere, fully opaque, correct orientation on a rotated monitor.
- The folder is created if missing; a read-only or missing Pictures folder produces an error dialog and the clipboard copy still happens.

## Developer self-test (debug builds or `--features dev-hooks`)

Drives a capture from the terminal, no mouse needed, and prints the timings. **Run it with the screen awake** (no screensaver, not locked).

```sh
pnpm dev:web &                       # debug builds load the frontend from the Vite dev server
cd src-tauri
LUMENGRAB_DEV_CAPTURE=area LUMENGRAB_DEV_AUTOSUBMIT=1 cargo run                    # also: window, fullscreen
LUMENGRAB_DEV_CAPTURE=area LUMENGRAB_DEV_AUTOSUBMIT=1 LUMENGRAB_DEV_SELFTEST=1 cargo run   # overlay exclusion check
```

- The log shows `+N ms` per phase and `overlay on display X visible N ms after the capture started` (hotkey to overlay).
- Self-test: with the overlays up, every display is captured again and compared with the frozen frame. Ratio about **1.00** = overlays are
  not in the capture (`set_content_protected` works). A ratio near **0.55** = the overlay is in the capture (it dims by 45%).
  It also saves `/tmp/lg-selftest-sck-<id>.png` and a `screencapture` reference. Please send me the printed lines.
- Files land in `Pictures/LumenGrab`; delete the test files afterwards.

## UI screens (built from LumenGrab.pen)

- **Capture overlay:** the toolbar at the bottom switches Area / Window (keys A / W); **Fullscreen** (F) captures the whole display under that overlay; the X cancels. While dragging, hold **Space** to move the selection. The size badge shows output pixels. Check it on both displays.
- **Settings** (tray menu, "Settings…"): General has Theme (System / Light / Dark; takes effect in all windows) and the save folder with **Open**. Launch at login and sound say _Soon_ and are disabled on purpose. Hotkeys lists the real shortcuts; if another app owns one it is flagged "In use by another app".
- **Permission window:** appears at startup when Screen Recording is not allowed, and when a capture needs it. "Open System Settings" must add LumenGrab to the list and open the right pane; "Check again" (or coming back to the window) turns it into the green confirmation; "Restart LumenGrab" relaunches the app.
- The tray menu itself is the native menu (not styled by the design).
