# ADR 0002: How the `.lumengrab` format is implemented (M3)

Status: accepted (M3). The format itself is specified in [`docs/FORMAT.md`](../FORMAT.md); this note records the
implementation decisions that are not obvious from the code.

## Decisions

- **The format lives in TypeScript (`src/document/`), not in Rust.** AGENTS.md says Rust stays thin. The container, the Zod schemas, the
  migrations and the rendering have no Tauri imports, so they run in the browser mock and in Vitest (plain Node, no display). Rust only
  moves bytes: it opens files, shows dialogs, creates the viewer windows and guards which paths a page may touch (`document.rs`, `fsutil.rs`).
  No Rust zip crate: it would duplicate the logic.
- **Libraries:** `zod` 4 (MIT) for validation, `fflate` (MIT, small) for ZIP. Both are pure JavaScript.
- **Reading counts real bytes.** `container.ts` uses fflate's *streaming* `Unzip` and adds up what actually comes out of the inflater, so a
  decompression bomb cannot hide behind small declared sizes (tested with a header that lies and with a 3 MB zero entry against a 1 MB limit).
  Entry names are checked before any data is read; the ZIP end record must exist and list exactly the entries that are in the file (a file that is
  cut off, or whose directory disagrees with its contents, is rejected).
- **Nothing is dropped.** Every Zod object is a `looseObject`; unknown ZIP entries are kept in `extraEntries`; a layer `type` this version does not
  know becomes an opaque layer (kept, not drawn). A *known* type with broken fields is an error that names the field (`layers.2.width`), it is never
  downgraded to opaque.
- **Read-only is decided by the manifest.** `minReaderVersion` above the app's version means view-only from `preview.png` and the manifest; the
  project of such a file is not used (it may not fit the schema, and its pixels could include what a newer redaction was meant to hide). A newer
  `formatVersion` with an old `minReaderVersion` stays editable and round-trips unknown parts. A file upgraded by a migration is written with the
  app's version as `formatVersion` and `minReaderVersion`.
- **Previews bake redactions.** `preview.png` is shown in history and the file manager, so it must never contain the pixels under a redaction. The
  redaction pass runs on the full source image before the crop (`render/flatten.ts`), solid is always opaque, blur has a minimum strength, pixelate
  uses seeded noise and a random sample per block. Annotations are drawn into previews from M4 on.
- **A page never names a path.** Rust keeps a registry: a viewer window reads only the file it was opened for; saving needs a one-time grant from a
  save dialog the user just confirmed (`pick_save_target` returns a token, `write_granted_file` consumes it, the body travels as raw bytes). "Show"
  after a save reveals the granted file by token. The only address the page can open is the Releases page.
- **Golden fixtures are written by independent code.** `scripts/make-fixtures.mjs` does not use `src/document` (fflate and `node:zlib`, literal
  JSON), refuses to overwrite, and was run once; each fixture has a hand-written `.expected.json` instead of a snapshot that `-u` could rewrite.
  `.gitattributes` marks them binary and `.prettierignore` keeps formatters away.
- **File association:** `bundle.fileAssociations` (extension, MIME type `application/vnd.lumengrab`, UTI `app.lumengrab.document` conforming to
  `public.data`). macOS delivers a double-clicked file through `RunEvent::Opened`, Windows through `argv`; a second launch reaches the running tray app
  through `tauri-plugin-single-instance` (not in dev builds, so `tauri dev` can run next to an installed copy).

## Not done yet (on purpose)

- Drawing annotations into previews and exports (the editor, M4): "Export as PNG" is therefore offered only for documents without annotation layers.
- Autosave and recovery, the optional `.bak` file, a document icon for the file type.
- Windows: the association is created by the NSIS installer and is checked by hand (see the test checklist).
