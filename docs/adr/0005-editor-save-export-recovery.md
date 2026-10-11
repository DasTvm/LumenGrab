# ADR 0005: Saving, exporting and recovering in the editor (M4)

Status: accepted (M4). Spec: [`docs/FORMAT.md`](../FORMAT.md) sections 6 and 7.

## Decisions

- **The page never names a path.** A document window can save only "its" file (`document_save`, addressed by window label); everything else goes
  through a save dialog whose result is a one-time grant (`pick_save_target` -> `write_granted_file`), as since M3. After a Save As of a new capture
  `document_bind_saved` makes the window that file. Recovery copies are named by document id only (letters, digits, `-`, `_`), never by path.
- **Three kinds of document window:** a `.lumengrab` file, a screenshot opened for editing (Quick Access Edit; the first save asks where), and
  recovered work (read from the recovery folder, unsaved until the user saves it somewhere).
- **Unsaved changes guard:** the page tells the native side whether it is dirty (`document_set_dirty`). Rust intercepts `CloseRequested` for dirty
  windows, keeps them open and asks the page (event with the window label in the payload), which shows the dialog and closes with `document_close`.
  Quitting the whole app is not guarded: the autosave is the safety net there.
- **Autosave** writes a complete `.lumengrab` into `<app data>/recovery/<documentId>.lumengrab` three seconds after the last change, atomically, silently
  on failure. Saving or "Don't save" deletes it. At startup, if any exist, the "Recover unsaved work" window opens (also in the tray menu).
- **Export renders once, in the page.** Redactions burned in, annotations drawn, crop, resize (canvas, high quality), then the encoder. The size
  shown for JPG and WebP ("about 380 KB") is a real encode at that quality.
- **WebP is encoded natively.** The macOS WebView (WebKit) cannot encode WebP from a canvas, and the Windows one can. Rather than hide WebP on
  the Mac, the app calls `encode_webp` (libwebp through the `webp` crate: MIT/Apache-2.0, libwebp BSD-3) when the canvas cannot. JPG and PNG use the
  canvas on both systems. A canvas that silently returns a PNG for another format is detected and refused.
- **A `.lumengrab` with redactions is never saved quietly the first time:** the Export dialog opens on the `.lumengrab` tab with "This file keeps your
  original pixels" and "Export flat PNG instead". Saving an existing file in place (Cmd/Ctrl+S) does not ask again.
