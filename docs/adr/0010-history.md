# ADR 0010: The history of captures

Status: accepted (M6). Designed in `LumenGrab.pen` ("M6 / History", "M6 / Settings / History").

People need to find a capture again, copy it, edit it or pin it, also after the Quick Access card has gone and without hunting through the screenshots folder.
It has to stay on the device and must never touch what the user saved themselves.

## Decisions

- **The history keeps its own copy.** Every capture that was saved is also copied into `<app data>/history/` (`<id>.png`, `<id>.thumb.png`, and `<id>.orig.png` when the
  automatic look was put on, which Edit opens). `index.json` lists them (`version`, `entries`). The files the user saved (`Pictures/LumenGrab`, Save as…) are **never touched
  or removed** by the history: deleting from the history only deletes the history's copy. The copy costs disk space, so Settings shows the space used and a retention.
- **Retention is a setting, default one month** (1 week, 1 month, 3 months, 1 year, forever). It is applied at start, after each new capture and when the setting changes, and only
  removes the history's copies. A safety limit of 5000 entries holds whatever the setting says.
- **Off means off.** "Keep a history of my captures" off: nothing new is recorded; what is there stays until the user clears it. "Keep a picture of text captures" (default off) decides whether a
  text capture leaves its picture behind (text capture: ADR 0011).
- **The page never names a path.** Every command takes the id of an entry. The thumbnails come through the `lgcapture://localhost/history-<id>` scheme the overlay already uses (no CSP change).
- **Deleting has two forms.** "Remove from History" deletes the copy for good. "Move to Trash" hides the entry at once and moves the copy to the system Trash after 8 seconds unless "Undo" comes first
  (the Trash crate cannot restore on macOS, so the undo window is ours). Several at once ask first.
- **A damaged index is an error, not an empty list**: the window says so with "Try again", "Open history folder" and "Start with a new history". A file written by a newer version is not overwritten.
- **Index writes are atomic** (`fsutil::write_atomic`), files without an entry (a crash between the copy and the index) are removed at start.
- **Two layouts** for the filters (sidebar with counts, or chips above the grid), chosen in Settings > History.
- **No format change.** The history is app data, not part of the `.lumengrab` file.

## Not in M6

Searching the text inside pictures (it would store recognised text, which needs its own privacy decision), restoring pins after a restart, history of documents.
