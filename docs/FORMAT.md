# `.lumengrab` File Format Specification

Status: **Draft v1** · Extension: `.lumengrab` · Source of truth for the document model.

## 1. Goals

1. **One file is enough.** A user can reopen and keep editing a capture with only this single file, with no side files.
2. **Non-destructive.** The original image is never altered. Everything else is parameters.
3. **Future-proof.** Old files always open. New files from newer app versions degrade gracefully.
4. **Simple and inspectable.** Standard ZIP + JSON + PNG. Easy to debug, easy to test.
5. **Safe.** Corrupt or hostile files never crash the app or write outside the sandbox.

Non-goals: video projects (separate format later), cloud sync, encryption.

## 2. Container

A `.lumengrab` file is a **ZIP archive** (ZIP64 not required). MIME type: `application/vnd.lumengrab`. macOS UTI and Windows ProgID registered through Tauri `bundle > fileAssociations`.

```
example.lumengrab
├─ manifest.json     required
├─ project.json      required
├─ source.png        required   original image, unmodified (stored, not re-compressed)
├─ preview.png       required   rendered result, max 1024 px long edge (for history, Finder/Explorer)
└─ assets/           optional   user-supplied images (custom backgrounds, logos)
   └─ <sha256>.<ext>
```

Rules:
- Entry names are lowercase, forward slashes, no `..`, no absolute paths, no drive letters (**zip-slip protection**).
- Asset file names are the SHA-256 of their content (dedupe, tamper-evident).
- `source.png` and `assets/*` are stored without extra compression; JSON may be deflated.
- Limits on read: max 512 MB total uncompressed, max 64 entries, max 16k x 16k px for any image. Reject beyond that with a friendly error.

## 3. `manifest.json`

```json
{
  "format": "lumengrab",
  "formatVersion": 1,
  "minReaderVersion": 1,
  "createdBy": "LumenGrab 0.1.0",
  "createdAt": "2026-10-06T12:00:00Z",
  "modifiedAt": "2026-10-06T12:05:00Z",
  "documentId": "uuid-v4",
  "source": { "file": "source.png", "width": 2880, "height": 1800, "scale": 2, "sha256": "..." }
}
```

- `formatVersion`: the version of the **file layout and project.json schema**. Integer. Bumped on every schema change.
- `minReaderVersion`: the lowest app format version able to read this file correctly. If the app's supported version is lower, open **read-only** with a notice ("Created with a newer version") instead of editing, to avoid data loss.
- `source.scale`: display scale of the capture (1, 2, ...), informational.

## 4. `project.json` (v1)

All geometry is in **source-image pixel space** (origin top-left, y down). Colors are hex `#RRGGBB` or `#RRGGBBAA`. Angles in degrees. IDs are short unique strings.

```ts
// Reference types. Implement as Zod schemas in src/document/schema.ts
type Project = {
  version: 1
  crop: { x: number; y: number; width: number; height: number } | null   // null = full image
  layers: Layer[]                     // z-order: first = bottom
  presentation: Presentation
}

type Layer = Annotation | Redaction

type BaseLayer = {
  id: string
  visible: boolean
  locked: boolean
  name?: string
}

type Annotation = BaseLayer & (
  | { type: "arrow";     from: Pt; to: Pt; style: "straight" | "curved" | "outlined" | "double"; color: string; width: number; curve?: Pt }
  | { type: "line";      from: Pt; to: Pt; color: string; width: number; dash?: number[] }
  | { type: "rect";      x: number; y: number; width: number; height: number; rotation: number; stroke: string | null; fill: string | null; strokeWidth: number; radius: number }
  | { type: "ellipse";   x: number; y: number; width: number; height: number; rotation: number; stroke: string | null; fill: string | null; strokeWidth: number }
  | { type: "text";      x: number; y: number; width: number | null; text: string; fontId: string; size: number; weight: number; color: string; background: string | null; align: "left" | "center" | "right"; rotation: number }
  | { type: "counter";   x: number; y: number; value: number; color: string; size: number }
  | { type: "pencil";    points: number[]; color: string; width: number; smoothing: number }
  | { type: "highlighter"; rect: Rect; color: string; opacity: number }
  | { type: "spotlight"; rect: Rect; shape: "rect" | "ellipse"; dimOpacity: number }
)

type Redaction = BaseLayer & {
  type: "redaction"
  mode: "blur" | "pixelate" | "solid"
  rect: Rect
  strength: number          // blur radius / pixel block size
  color?: string            // solid mode
  seed: number              // randomization seed for pixelate, so output is deterministic per export
}

type Presentation = {
  enabled: boolean
  background:
    | { type: "solid"; color: string }
    | { type: "gradient"; angle: number; stops: { offset: number; color: string }[] }
    | { type: "mesh"; seed: number; colors: string[] }
    | { type: "image"; asset: string; fit: "cover" | "contain" }   // asset = file name in assets/
    | { type: "transparent" }
  padding: { top: number; right: number; bottom: number; left: number }
  autoBalance: boolean
  cornerRadius: number
  shadow: { enabled: boolean; x: number; y: number; blur: number; spread: number; color: string }
  frame: { type: "none" | "macos-window" | "windows-window" | "browser"; title?: string; url?: string }
  aspect: { mode: "free" | "fixed"; ratio?: [number, number] }
  exportScale: number
}
```

Notes:
- Redactions are layers like any other but are **always rendered baked** into flat exports (see section 7).
- New layer types and fields are added by bumping `version` (see section 5).
- `pencil.points` is a flat `[x0, y0, x1, y1, ...]` array.

## 5. Versioning and migrations (mandatory process)

1. `manifest.formatVersion` and `project.version` are integers that start at 1.
2. **Any** change to `project.json` or the container layout that old readers cannot handle correctly requires:
   - bump `formatVersion` and `project.version`,
   - a pure migration function `migrate_vN_to_vN+1(project)` in `src/document/migrations/`,
   - a **golden fixture** `fixtures/lumengrab/vN+1-*.lumengrab` plus the previous fixtures kept as is,
   - a test that opens every fixture, migrates to latest, validates with Zod, and compares against a snapshot,
   - an update to this document.
3. Additive, optional fields that old readers can safely ignore do **not** need a version bump, but must be listed here.
4. **Unknown fields are preserved** on load and written back on save (use passthrough / keep an `extra` bag). Never silently drop data.
5. Opening a file with `minReaderVersion` higher than the app supports: open **read-only**, show a clear message, offer "Export as PNG".
6. Migrations only go **forward**. Files are upgraded in memory on open; the file on disk is rewritten only when the user saves.
7. Never delete or edit existing golden fixtures.

## 6. Reading and writing

**Read:**
1. Open ZIP, enforce limits (section 2).
2. Parse `manifest.json`, check `format === "lumengrab"`, check `minReaderVersion`.
3. Parse `project.json`, run migrations to latest, validate with Zod.
4. Load `source.png`; verify `sha256` and dimensions against manifest. On mismatch show a warning but still open.
5. Resolve asset references. A missing asset falls back to a neutral background and shows a notice, no crash.

**Write:**
1. Build all entries in memory (or a temp file).
2. Render `preview.png` from the current state (flat, redactions baked).
3. Write ZIP to a temp file next to the target, `fsync`, then **atomic rename**.
4. Keep the previous file as `.bak` until the write is confirmed (optional setting).

Autosave: editor changes autosave to a recovery location in the app data dir, not over the user's file, until the user saves.

## 7. Security and privacy

- **Redaction:** the `.lumengrab` file contains the **unredacted original** in `source.png`. This is by design (editability). Therefore:
  - Show a notice when saving or sharing a `.lumengrab` that contains redaction layers.
  - Default sharing/export (PNG/JPG/WebP/clipboard) is always **flat** with redactions baked in and pixels destroyed.
  - Pixelate uses block randomization seeded by `seed` so it cannot be reversed.
- Never execute or evaluate anything from the file. It is data only.
- Validate every path, size, and number (clamp NaN/Infinity, absurd coordinates).
- No network access is ever triggered by opening a file.

## 8. Fonts

- Only bundled, freely licensed fonts, referenced by `fontId` (e.g. `"inter"`, `"jetbrains-mono"`).
- Unknown `fontId` falls back to the default font and shows a one-time notice.
- Fonts are not embedded in the file in v1.

## 9. Test requirements

- Round-trip test: create -> save -> load -> equals original (including unknown fields).
- Golden fixtures for every released version open and migrate cleanly.
- Fuzz-style tests: truncated ZIP, bad JSON, wrong hashes, zip-slip names, oversized images, huge coordinates.
- Rendering test: flat export of a fixture matches an expected image (tolerance-based), and redacted regions provably differ from the source pixels.

## 10. Open decisions (resolve before v1 freeze)

- Trademark / conflict check for the name LumenGrab (extension `.lumengrab` is fixed).
- Whether to ship an additional optional "editable PNG" export (embedding the project into a PNG chunk). Not part of v1; would reuse the same `project.json`.
- Whether `preview.png` should be WebP for size.
