# Capture test checklist: multi-monitor and mixed DPI

Manual tests for M1 (capture MVP). Run them on your own hardware; nothing here can be verified in CI.
Hotkeys (both OS): **Ctrl+Shift+1** is the main one (capture bar, starts in the default mode from Settings > General).
The quick picks start straight in one mode, without the bar: **Ctrl+Shift+4** area, **Ctrl+Shift+5** window, **Ctrl+Shift+3** fullscreen.

**How to report:** one row per setup: machine, OS version, monitors (resolution, scale %, arrangement), result per
section, notes, screenshot.

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

## 6b. Warm overlay windows

- The overlay windows are created once, hidden, shortly after the app starts and reused for every capture. After 20 captures in a row the memory is stable and
  no earlier selection, highlight or image is visible when an overlay appears (it must always show the new frozen frame).
- Start a capture right after launching the app (before the windows exist): it still works, only the first one is slower.
- Change the display layout (plug or unplug a monitor, change the resolution or scale, move a monitor): the next capture rebuilds the overlay windows and
  covers every monitor exactly; the capture after that is fast again.
- Switch Space / virtual desktop, or use a fullscreen app, then capture: the overlay appears on the current desktop, not on the one where it was created.
- Idle: no CPU use while the app sits in the tray.

## 6c. Quick Access and notices

- After each capture a card appears in the chosen corner (Settings > General > After capture) on the monitor under the cursor, 16 px from the edge, above the Dock / taskbar and below the menu bar.
  Check all four corners, and with the Dock / taskbar on a different edge.
- The app you were working in keeps the keyboard focus when a card appears and when you click its buttons (type something right after a capture).
- Copy puts the image on the clipboard (paste into Paint / Preview / Slack). Save as… asks where; Show opens the folder with the file selected. Close, Esc (after a click on the card), and the auto-close line
  (pauses while the pointer is on the card or a dialog is open).
- Several captures in a row: at most 3 cards stacked, newest in the corner, a 4th closes the oldest; with the large style only the newest is large. Cards never overlap and never leave the screen.
- Large style: size chip, file name, "Area · 1.2 MB". Delete shows "moved to Trash" with Undo; Undo brings the card back and the file stays; letting the line run out or closing moves the file to the Trash / Recycle Bin.
- Drag the picture to a chat, a browser upload field, a folder: the file arrives, a hint appears while dragging, Esc cancels.
- **Windows only:** transparent window edges (24 px around a card) swallow clicks, which is accepted; check that the buttons of stacked cards are all clickable. WebView2 shows the transparent card without a white or black box.
- **Mixed DPI:** a card on a 150 % monitor next to a 100 % one is placed in the right corner of the right monitor and has the right size.
- Notices: make a folder read-only (or set an impossible one) to see "Could not save", then Retry and Choose folder…; hold the shortcut in another app to see "already in use";
  turn Screen Recording off while the app runs (macOS) to see the dialog. The first-start hint appears once on Windows after the first launch and not again.

## 6d. Documents (`.lumengrab`)

- Quick Access **Save as…**: the dialog offers PNG and LumenGrab document. Both write the file; "Show" in the card then reveals that new file. A save into a read-only folder shows the red status row with Retry.
- Double-click a `.lumengrab` file: LumenGrab (running in the tray or not) opens a viewer window with the preview, size, date and layer count. A second double-click while the app runs reuses it (no second process, no
  "shortcut in use" notice). Opening the same file twice brings the existing window to the front.
- Tray menu **Open Document…** opens the file dialog.
- A damaged or cut-off file shows "Can't open this file" with a one-line reason and **does not change the file** (check its size/date). A file from a newer version shows "Opened read-only", then the viewer with a Read-only
  badge; "Check for updates" opens the GitHub Releases page in the browser.
- **Windows only:** after installing, the `.lumengrab` extension is associated with LumenGrab (Explorer shows the type "LumenGrab document"; double-click opens the viewer; "Open with" lists the app). Double-click while the app is
  already running opens the viewer in the running instance. Uninstalling removes the association.
- **macOS only:** Finder shows "LumenGrab Document" as the kind; Get Info > Open with offers LumenGrab.
- The saved `.lumengrab` unzips (`unzip -l`) into `manifest.json`, `project.json`, `source.png`, `preview.png`, and `source.png` is byte-identical to the PNG that was saved.

## 6e. Editor (M4)

Open it with Quick Access **Edit** (a new capture), by double-clicking a `.lumengrab`, or from the tray (Open Document…). The window is laid out for 1280 x 880.

- **Edit** on a Quick Access card opens the screenshot as an unsaved document (name without extension, no dot); the card closes. Closing the editor window right away closes it without a question.
- Every tool by mouse on real captures: rectangle, ellipse, line, arrow (all four styles; drag the bend handle of a curved one), pencil, highlighter (text stays readable under it), counter (numbers count up, Restart at 1), spotlight (rectangle and ellipse),
  text (type, wrap by the width handle, Cmd/Ctrl+Enter, double-click to edit again), redaction (blur, pixelate, solid; the panel's strength). Selection handles, the rotate handle and Shift/Alt while drawing or resizing.
- Cmd/Ctrl+Z, Shift+Cmd+Z (Ctrl+Y on Windows), Delete, Cmd/Ctrl+D, Cmd/Ctrl+G, arrow keys nudge, zoom with Cmd/Ctrl+wheel and trackpad pinch, Space + drag pans, Fit / 100 %.
- Layers panel: hide, lock, rename (double-click or Enter), drag to reorder and into groups, group / ungroup, context menu with the shortcuts of the design.
- Crop: ratios, W and H fields, Apply (Enter), Cancel (Esc), Reset; the crop can be opened again and adjusted; undo brings back the full picture.
- **What you see is what you export:** export PNG at 1x, 0.5x, 2x, a custom size, JPG and **WebP** (macOS: encoded by the app, not the WebView), and compare them with the editor. Blur, pixelate and solid are really destroyed (open the PNG and
  try to read what was under them). Copy (button and dialog) pastes the same picture into another app.
- **Save:** Cmd/Ctrl+S on a new capture asks where and creates a `.lumengrab`; later saves write to it. With a redaction in the document the Export dialog shows "This file keeps your original pixels" and "Export flat PNG instead".
  Unzip the file: `source.png` is byte-identical to the capture, `preview.png` shows annotations and redactions.
- **Unsaved changes:** change something, close the window (red button / Cmd+W): "Save changes to …?" with Save, Don't save, Cancel. Cancel keeps the window; a failed save keeps it open with "Could not save" and Retry / Save elsewhere….
- **Recovery:** change something, wait 4 seconds, kill the app (`kill -9`), start it again: "Recover unsaved work" lists the document with its time and what changed; Recover opens it as unsaved; Discard all deletes the copies. Tray menu **Recover Unsaved Work…** opens the same window. A saved document leaves no recovery copy.
- **Windows only:** shortcuts use Ctrl, the Export and Unsaved dialogs are readable at 150 % and 200 % scale, WebP and JPG export work, dragging handles feels the same on a 125 % monitor.
- **Dock and Cmd+Tab (macOS):** while an editor, Settings or the recovery window is open, LumenGrab shows in the Dock and in Cmd+Tab (with its windows in the Window menu); when the last of them is closed it goes back to a menu bar app
  without a Dock icon. The capture overlays and Quick Access cards never make the Dock icon appear. (Windows lists the windows in the taskbar and Alt+Tab as before.)
- **Colour picker:** "+" in any swatch row opens LumenGrab's own picker (square, hue, hex field; the eyedropper only where the WebView has one, e.g. Windows). Save a colour, close and reopen the editor: it is in every swatch row.
- **Fonts:** the text panel lists the eight fonts that ship with LumenGrab and every font installed on the device (search). Pick an installed font, save the `.lumengrab`, open it on a device without that font: Inter is used and a notice says so.
  Type the font size (50, Enter) instead of clicking.
- Dark mode (derived, not designed): all of the above is readable; the lime handles are visible on the picture.
- Not covered by automated tests: IME text input (Japanese, Chinese) in the text field, very large pictures (5K): drawing a blur over one should stay smooth.

## 6f. Presentation (M5)

Open the editor's **Presentation** tab (top bar, or Cmd/Ctrl+Shift+P). The first time on a picture it gets your default look (Midnight until you choose one).

- **Looks:** click each of the six built-in looks; the canvas changes at once and Cmd/Ctrl+Z takes it back. Save the current settings with "Save as my look" (leave "Aspect ratio" unticked): it appears under My looks, survives closing and reopening LumenGrab, and can be renamed, updated with the current settings and deleted (Undo in the toast brings it back). A name that is taken asks before it replaces.
- **Backgrounds:** solid, gradient (add a colour by clicking the bar, drag the dots, Linear / Radial, reverse, shuffle), mesh (3 x 3 and 4 x 4, drag a point, Shuffle), image (choose a PNG / JPG / WebP; a look made with it keeps the picture after a restart), blurred screenshot. Compare the editor with a PNG export: same picture.
- **Layout:** padding (slider, four edges, Auto-balance, Balance edges), **Trim empty edges** (take a screenshot with a lot of empty space on one side, e.g. a small window on a white page: the crop leaves the smallest margin the picture has on every side and never cuts at the content, even when the content touches one edge; the sliders "Space left and right" and "Space top and bottom" then add or remove space per axis, 0 sits right at the content; try a capture with good space at the left and top and too much at the right and bottom; Undo brings the full picture back), corner radius, shadow presets and colours, the six window frames (title, address, light / dark; check the title bar text in Inter and, for Terminal, JetBrains Mono).
- **Aspect ratio:** every basic ratio, Custom (7:3), and the social formats: the export is exactly 1080 x 1920 px for Instagram Story, and "Show safe area" shades the zones. Drag a 5K capture into the editor: Export stays within 16,384 px and says so.
- **Export, Copy and the saved `.lumengrab`'s preview** all show the presentation; the Export dialog sizes are those of the finished picture. Switch "Remove the presentation": exports are the plain picture again.
- **Default look (Settings > Presentation):** pick a look, see the preview. Turn on "Apply the default look automatically", take a screenshot: the file in Pictures/LumenGrab, the clipboard (paste it), the Quick Access thumbnail and the drag-out all show the look. A copy of the capture without the look is in the app's `originals` folder (macOS: `~/Library/Application Support/<app id>/originals`, Windows: `%APPDATA%\<app id>\originals`) and is removed after 30 days.
- **Edit** on such a card opens the capture without the look and puts the look on as a presentation (frame, background and shadow appear only once). With "Open the editor in: Presentation" a new capture starts in that tab.
- **Fallback:** with the automatic look on, kill the hidden render page (or set the look to a picture and delete it from the app's `looks/assets` folder), then take a screenshot: it is saved and copied as it is, and a "Could not apply your look" card offers Try again. Nothing is lost.
- Timing: a 5K capture should show its card in well under a second with the look on (the debug build prints "look applied ... in N ms").
- **Windows only:** the frame fonts, the shadow, and the automatic look work on a 150 % / 200 % display and with two displays of different scale.
- Dark mode (derived, not designed): the panel, the gallery and the dialogs are readable.

## 6g. Updates

Needs a build with the public key (docs/UPDATER.md); a build without it shows "Updates are not set up in this build" and no tray entry.

- **Start with the key:** a build that has the public key must start cleanly and show the tray entry (a start-up crash once hid in exactly this combination).
- **Settings > Updates:** version and "Last checked", "Check now" (checking, then up to date or a new version with its notes grouped New / Improved / Fixed), "See what's new" opens the release page, "Skip this version" hides it from the automatic check.
- **Install and restart** on a found version: it downloads (progress and time left; Cancel stops it), then says it is ready. "Restart now" installs and the app comes back as the new version (check Settings > Updates and the version). On macOS the note about Screen Recording appears; after the restart macOS may ask for that permission again (unsigned builds).
- **The corner card:** with the daily check on, a newer published release shows "LumenGrab X is here" on its own (Install and restart / Later / See what's new). The same card becomes the progress card, then "A new version is ready". Close it: Settings still shows the state.
- **The menu bar / tray entry:** "Check for Updates…" opens Settings > Updates and checks; while a download runs it reads "Downloading Update…"; when ready it reads "Restart to Update".
- **Unsaved documents:** change something in an editor, choose Install and restart: the dialog lists the document. "Install and restart" there makes the editor ask "Save changes?"; Save or Don't save, then the app restarts as the new version. Cancel in "Save changes?" calls the restart off (nothing is installed). "Later" closes the dialog.
- **Failures:** switch off the network and press Check now ("Could not check for updates", Try again, Copy details); a package with a wrong signature ("Update failed: security check", nothing installed).
- **Privacy:** with "Check for updates automatically" off, LumenGrab makes no request at all until Check now (watch the network with Little Snitch / the Windows firewall log).
- **Windows only:** the NSIS installer updates in place and starts the new version; the tray entry and the restart dialog look right at 150 % and 200 %.

## 6h. Animated backgrounds (M5b)

Everything here needs a real GPU and a real WebView: check it on a Mac with Apple silicon and on Windows (an Intel or AMD laptop is the interesting case).

- **The Animated tab:** Presentation > Background > Animated shows 12 looks with a still picture each, slow and soft (no flicker, also on Windows). Click one: the background moves in the editor (about 30 pictures a second, no stutter while you type or drag a slider). "Animate in editor" off stops it; turn on the system's Reduce Motion (macOS) / switch off animations (Windows): it starts paused with the notice, and the switch is off and greyed.
- **Still frame:** the slider moves the moment that every picture uses. Copy to the clipboard, export a PNG and save the file: all show that moment. "Use this frame as picture" turns the background into an ordinary picture (undo brings the animation back).
- **Background Studio:** "Open Background Studio". Layers: add every kind of generator and effect from Add, change a slider (the preview follows at once), hide, solo, duplicate, drag to reorder, change the blend, the palette (add, change, remove a colour), Start from…, the dice (Randomize), the loop length and the seed. Undo and redo (Cmd/Ctrl+Z) inside the Studio; Cancel with changes asks; Apply is one undo step in the editor.
- **Timeline:** play, pause, step by frame, drag the playhead, drag the diamond (still frame), speeds 0.25x to 2x. **Show seam** must show no jump where the end flows into the start, for every look. Watch Activity Monitor / Task Manager: the GPU and CPU load are fine while the Studio plays.
- **Customise:** under the looks, Speed (shown as 0.3× to 3.3×; 1× is a loop of 20 seconds, the still frame stays on the same picture), the palette colours, the base colour and the few sliders of the look (for example Softness, Flow, Grain). Each change is one undo step, the look stays marked.
- **Shader editor:** Animated tab > Your shaders > New shader: the editor opens at once on a working example, no dialog. Change the code (the preview and "Saved · works" follow while you type), make a typo (red line, "last version that worked" keeps playing, the shader stays saved), Add a setting (the `// @param` line appears and the control follows), Examples, Help (inputs, helpers, the prompt for an AI: paste it into a text editor and read it). Done is the only button: it closes the editor, the shader is the background, and its tile is under Your shaders. Esc does the same. Also in the Studio: Add > Write new shader… adds a layer at once, Done returns to the Studio.
- **Heavy code:** paste a shader with a very long loop (for example `for (int i = 0; i < 200; i++) { for (int j = 0; j < 200; j++) { ... } }` doing a lot of work per step): the layer is switched off with the "too heavy" notice, the app stays responsive, "Turn on again" works once the code is simpler. Code over 16 KB says "Too long".
- **Code from other people:** save a document that has a shader layer, open it on another computer (or delete `shaders/trusted.json` in the app's config folder): the layer is not drawn, the Studio says "This file contains custom shader code", the code is read-only until "Run custom code". After that it runs, also the next time the file is opened on this computer. Flat exports of such a file made before the permission have no shader layer.
- **Your shaders:** the tile applies the shader with one click; its menu has Edit shader, Duplicate, Rename and Delete (Delete offers Undo). Add > My shaders in the Studio (also in another document and window) lists the same shaders.
- **Export of a moving background:** with an animated background, the normal Export dialog (top right) has "Video / GIF", which opens the dialog of the Studio. The size it announces ("About 2.4 MB") is measured a moment after each change (a soft gradient is far smaller than noise) and should be close to the file that is made.
- **Dark mode:** switch the system to dark: the Annotate / Presentation switch shows dark text on the lime, and the messages that pop up (copied, saved) are dark with a readable lime check.
- **Export:** video (MP4 in the macOS and Windows WebView; if this computer cannot, the dialog says so and offers WebM or GIF), GIF, picture. Open the MP4 in QuickTime / the Windows player and the GIF in a browser: the loop must close without a jump. Check "Background only" and "Whole composition", 720p / 1080p / 4K, 60 fps; Cancel while it renders; a long export at 4K and 60 fps is shortened with the warning. Progress and the time left are plausible.
- **Automatic look:** make an animated look the default (the star in the Animated tab or Settings > Presentation), then take a screenshot: the file, the clipboard and the card show the still frame, and it still takes about as long as a static look (the hidden window needs WebGL). Settings > Presentation shows "… · animated" with the loop length; "Edit look" opens the Studio, Apply changes the default look.
- **No WebGL:** with the graphics acceleration of the WebView switched off (or in a virtual machine without a GPU) the Animated tab says so, the background is the plain fallback colour everywhere, nothing crashes, and the layers stay in the file.

## 6i. History, pins, text and all-in-one (M6)

Everything here is checked natively on macOS and on Windows. Tick the part that exists in the build you test.

- **History records:** take a few captures (area, window, fullscreen). Ctrl+Shift+H (tray: History…) opens the window; the captures are listed newest first with the right source, size and time, thumbnails sharp. A capture taken while the window is open appears when the window gets focus again.
- **History copies are separate files:** delete a screenshot in `Pictures/LumenGrab` in Finder / Explorer: its card in the history still works (Edit, Copy). "Show in folder" shows the history's copy then. Delete a file in the history folder (Settings > History > Open history folder): the card says "File not found" and can be removed.
- **Edit with the automatic look:** with the automatic look on, Edit from the history opens the capture without the look and puts it back as a presentation (like the Quick Access card).
- **Actions:** hover (Copy image, Edit, More), right-click menu, ⏎ opens, Cmd/Ctrl+C copies, Cmd/Ctrl+S saves a copy, Cmd/Ctrl+R shows in folder, ⌫ moves to the Trash. "Move to Trash" says "Moved to Trash · Undo": Undo within a few seconds brings the card back and nothing is in the Trash; after that the file is in the system Trash (Recycle Bin on Windows). Several selected ask first.
- **Retention:** set "Keep captures for" to 1 week, change the clock or wait (or edit `capturedAt` in `index.json` while the app is closed): the old captures and their files disappear at the next start or capture, the user's own files stay.
- **Off:** switch history off, take a capture: nothing new in the list, the notice "History is off" with "Turn on" shows. "Clear history…" frees the space it names, and the user's own files stay.
- **Damaged file:** with the app closed write junk into `index.json`: the window says "History can't be read"; "Try again", "Open history folder", "Start with a new history" all work.
- **Layouts:** Settings > History > Filters: sidebar and chips both work, the choice applies when the History window gets focus.
- **Pins:** pin from the Quick Access card (Pin button), from the History (hover button, menu, selection bar), from the editor (top bar) and with Ctrl+Shift+P (newest capture). A pin appears at its size of the capture (100 % = as big as it was on screen), a huge capture starts smaller. Drag moves it, the wheel steps the size, hover shows the bar (opacity slider, copy, edit, lock, close), right-click opens the menu (opacity levels, reset size, lock, show in history, close all). Esc / Cmd+W / the X close it. The ninth pin shows "8 pins are already on screen".
- **Pins and other windows:** a pin stays above normal windows and above a fullscreen app (macOS: on every Space; Windows: also over a maximised window), but under the capture overlay and the Quick Access cards. A new capture while pins are open: the overlay can select the area _under_ a pin and the pin is not in the picture (it is excluded like the app's other windows).
- **Lock:** Lock makes clicks go through to the window behind; the lock mark and the hint stay. Ctrl+Shift+U and the tray's "Unlock pins" unlock all; the tray item is greyed while nothing is locked.
- **Text recognition, editor:** open a capture with text (a web page, a form), "Copy text" in the top bar (or Cmd/Ctrl+Shift+T): the Text panel opens with "Reading…", the blocks appear in the list and as lime boxes on the picture, the whole text is on the clipboard (paste it into a text editor: same words, lines in reading order) and the toast says "Text copied · n words". Click a block in the list or a box on the picture: it is picked ("2 of 6 selected"), "Copy selection (2)" copies only those. Esc or the X closes the panel. Try German and English text, white-on-dark text and small text.
- **Redaction:** put a redaction (blur / pixelate / solid) over a word and read the picture again: the redacted word must not appear in the panel or on the clipboard.
- **A crop and the presentation:** with a crop, the lime boxes sit on the right words; with the Presentation tab open the text is still read from the picture itself.
- **QR codes:** a picture with a QR code (on a screen, a poster photo): the "Codes" section lists it with its address, the box on the picture says QR. "Open link" first shows the whole address (the host in bold), Cancel opens nothing, Open opens the browser. A Wi-Fi code has only Copy. Two codes are listed as QR code 1 and 2.
- **Quick Access:** "Copy text" on the card reads its picture: "Reading…", then "Text copied · n words"; with a QR code the card shows "Link found" with Copy / Open (Open asks with a system dialog first); a picture without text says "No text found". The History's menu "Copy text" does the same by entry. The pin's right-click menu "Copy text" answers with a card in the corner.
- **Windows without a language pack** (remove all OCR language capabilities or use a fresh VM): every one of these says "No language pack for text recognition" and "Open language settings" opens Settings > Time & language > Language & region. After installing one, "Read again" works.
- **Speed and memory:** a 5K capture is read in about a second or two on Apple silicon; the app stays responsive while it reads.
- **All-in-one:** Ctrl+Shift+1 (a new install; else pick All-in-one in the bar or in Settings > General): moving over a window outlines it with its app and size, a click takes it, a drag takes an area (handles, size), a click on bare desktop does nothing, Tab / Enter pick a window. Fullscreen (F) takes the display. On two displays only the one under the pointer shows the bar and hint; the highlight goes away when the pointer leaves it.
- **Repeat the last area:** take an area of a known size (say 1280 x 720), start again: **nothing of it is shown at first** (the hint says "Click a window or drag an area"). Press R (or "Repeat last" in the bar): a dashed outline of that size with its size follows the pointer, a click takes exactly that area centred on the pointer (kept on the display near an edge), R again (or another mode) hides it. The size is the same on a Retina and on a non-Retina display.
- **Text capture:** Ctrl+Shift+T (or "Text" in the bar, key T, or the tray): drag over some text. A card says "n words copied" (and goes away by itself), the words are on the clipboard, **no file appears in Pictures/LumenGrab and the Quick Access card does not show up**, and the History has nothing new (unless "Keep a picture of text captures" is on). An area without text says "No text found"; an area with a QR code offers "QR code found" with Copy and Open (a system question shows the address first).
- **Hotkey to selection:** press the capture shortcut from another app (a browser, a text editor), several times, also right after a pause of a minute or more: the frozen picture shows at once without a black flash, the crosshair works with the **first** press (no second click to get it), Esc cancels. Check it with one and with two displays, and when the other display is the one the pointer is on.
- **Sharpness:** take a screenshot of a page with small text and open it in the editor at Fit (the picture is shown at a third of its size): thin text must look as clean as in the original, not jagged; zoom in to 200 % and more: single pixels (that is meant). Compare with Preview / Photos on the same file.
- **The bar:** All-in-one, Area, Window, Fullscreen, Text, Scroll (greyed, "Soon"), and "Repeat last" only when there is one; the keys A, W, F, T and R work; Esc cancels everywhere.
- **Dark mode** and **a long list** (hundreds of captures): scrolling stays smooth, the window opens quickly.

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
