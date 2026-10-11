# `.lumengrab` File Format Specification

Status: **v2, implemented in `src/document/` (v1: M3, v2 adds the `group` layer: M4)** · Extension: `.lumengrab` · Source of truth for the document model.

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
- Limits on read: max 512 MB total uncompressed, max 64 entries, max 16k x 16k px for any image, max 8 MB for one JSON entry, max 5000 layers, entry names up to 256 characters. Reject beyond that with a friendly error.
- Entry names may only use `a-z 0-9 . _ -` in each path segment (no spaces, no uppercase). A single unsafe name rejects the whole file, before any data is read.
- Limits are enforced on the bytes that actually come out of the inflater, not on the sizes the headers claim (decompression-bomb protection). The ZIP end record must be present and must list exactly the entries that are in the file; a file that is cut off or whose directory disagrees with its contents is rejected. Folder entries are ignored.
- **Unknown entries are preserved**: any other safely named entry (for example one added by a newer version) is kept in memory and written back unchanged on save.
- Writing is deterministic: fixed timestamps, entries in the order `manifest.json`, `project.json`, `source.png`, `preview.png`, `assets/*` (sorted), unknown entries (sorted).

## 3. `manifest.json`

```json
{
  "format": "lumengrab",
  "formatVersion": 2,
  "minReaderVersion": 2,
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
- `createdBy` names the version that first created the file and is kept on later saves. `modifiedAt` is set on every save. Timestamps are UTC, `YYYY-MM-DDTHH:MM:SSZ`.
- `documentId` is a random UUID v4 created with the file and kept for its lifetime.

## 4. `project.json` (v2)

All geometry is in **source-image pixel space** (origin top-left, y down). Colors are hex `#RRGGBB` or `#RRGGBBAA`. Angles in degrees. IDs are short unique strings (1 to 64 characters).

`Pt` is `{ x: number; y: number }` and `Rect` is `{ x: number; y: number; width: number; height: number }`.

Numbers must be finite. A coordinate or length beyond +-1 000 000 is **clamped** to that value when the file is read; negative widths, heights, stroke widths and similar lengths are invalid. Opacities, `smoothing` and gradient offsets are 0 to 1.

```ts
// Reference types. Implement as Zod schemas in src/document/schema.ts
type Project = {
  version: 2
  crop: { x: number; y: number; width: number; height: number } | null   // null = full image
  layers: Layer[]                     // z-order: first = bottom
  presentation: Presentation
}

type Layer = Annotation | Redaction | Group

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

// v2. Layers that move, hide and lock as one. Children are in z-order like `layers` (first = bottom).
type Group = BaseLayer & {
  type: "group"
  layers: Layer[]           // may contain groups; at most 8 groups inside each other
}

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
- **A layer whose `type` this version does not know is kept as an opaque layer**: it is preserved with all its fields, written back, and never drawn. A layer of a known type with invalid fields is an error (the file is rejected with the field named), it is not downgraded to an opaque layer.
- `visible: false` layers are not rendered, redactions included. Everything else about a layer is preserved.
- **Groups (v2).** A group sits in the z-order of its parent like any layer and draws its children in order at that place. A hidden group hides everything inside it, **redactions included**. A locked group locks everything inside it (the editor does not select or change those layers). Groups are not drawn themselves: they have no geometry. The limit of 5000 layers counts every layer of the tree, groups included. Nesting deeper than 8 groups is an error (the file is rejected with the path of the group, e.g. `layers.1.layers.0`).
- **Redactions inside groups are baked like any other** (section 7): the renderer collects them depth first, skips those with a hidden layer or group around them, and applies them to the full source image before anything is drawn.
- A new document starts with `crop: null`, no layers, and this presentation: `enabled: false`, solid `#F4F4F5`, padding 64 on every side, `autoBalance: true`, `cornerRadius: 12`, shadow on (`x 0, y 20, blur 50, spread 0, #00000040`), frame `none`, aspect `free`, `exportScale: 1`.
- Redactions are layers like any other but are **always rendered baked** into flat exports (see section 7).
- New layer types and fields are added by bumping `version` (see section 5).
- `pencil.points` is a flat `[x0, y0, x1, y1, ...]` array.

## 4a. Rendering rules (normative)

The schema says *what* a layer is; these rules say *how it looks*. An old file must look the same in every later version, so a change to anything below is a format change (section 5). All lengths are source-image pixels; the editor, the preview, the export and the clipboard use the same drawing code (`src/editor/draw/`).

**Order.** (1) Visible redactions are applied to the pixels of the **full** source image, in z-order (section 7). (2) Visible annotation layers are drawn over the result in z-order, depth first through groups; an annotation is therefore always on top of a redaction, whatever their order in the file. (3) The crop is taken last, so annotations outside the crop are cut away. (4) Exports may scale the result (an export option; the document never changes).

**Colours** are `#RRGGBB` or `#RRGGBBAA` (the alpha multiplies with any layer opacity). **Hidden** layers and everything in a hidden group are not drawn.

**Boxes and rotation.** `rect`, `ellipse`, `text`, `highlighter`, `spotlight` and `redaction` are boxes with a top-left corner. `rect`, `ellipse` and `text` may be rotated by `rotation` degrees, **clockwise** on screen, around the centre of their box. A `counter` has its centre at `x, y` and a diameter of `size`.

- **rect**: rounded by `radius` (at most half the shorter side). Fill first, then the stroke, centred on the edge; no stroke if `stroke` is null or `strokeWidth` is 0. Corners are mitred, or round if `radius > 0`.
- **ellipse**: fills the box; fill, then stroke as for `rect`.
- **line**: round caps, `width` thick; `dash` is the on/off pattern in pixels (absent or empty = solid).
- **arrow**: the head is a triangle with its tip on `to` (and on `from` for `double`); its length is `max(4 x width, 12)`, at most half the arrow (a third for `double`), and half its width is 0.5 x its length. The shaft stops 0.2 x head length inside the head. `curved` bends the shaft as a quadratic Bézier from `from` through the control point `curve` to `to`; without `curve` the control point is the middle of the arrow pushed sideways by a fifth of its length (`(mx - dy x 0.2, my + dx x 0.2)`). A head points along the tangent at its end. `straight` and `curved` have a solid head, `outlined` a head that is stroked in the colour and filled white, `double` has a solid head at each end. Round caps and joins.
- **text**: the line height is 1.3 x `size`. `width: null` never wraps (only explicit line breaks); otherwise lines wrap at spaces, and a word wider than `width` is cut by characters. The text block is `width` wide (or as wide as its longest line); `align` places every line inside it. A `background` fills the block plus 0.3 x `size` on every side. Lines are centred vertically in their line box. Fonts: section 8.
- **counter**: a filled circle of `color`; the `value` is centred inside it in Inter 700, black or white, whichever contrasts better with `color`; the font size is 0.55 x `size` for one digit, 0.45 for two and 0.36 for more.
- **pencil**: `round(smoothing x 6)` smoothing passes (every inner point becomes 1/4 previous + 1/2 itself + 1/4 next; the end points stay), then a round-capped stroke through the middles of the segments with the points as control points. One point is a dot of diameter `width`.
- **highlighter**: the rectangle is filled with `color` at `opacity` using the **multiply** blend, so text underneath stays readable.
- **spotlight**: everything in the whole picture **outside** the shape (`rect` or the ellipse in the box) is darkened with black at `dimOpacity`. Several spotlights each darken for themselves.
- **group**: draws its children in order. **redaction** is never drawn (it is already in the pixels). A layer type this version does not know is skipped.

## 5. Versioning and migrations (mandatory process)

1. `manifest.formatVersion` and `project.version` are integers that start at 1. **v2** added the `group` layer. Every v1 project is a valid v2 project, so the migration `v1 -> v2` changes nothing but the version. New files are written with `formatVersion 2` and `minReaderVersion 2`: a v1 reader would see a group as an unknown layer, not draw its children and so export a redaction inside it unredacted, so it must not open such a file for editing.
2. **Any** change to `project.json` or the container layout that old readers cannot handle correctly requires:
   - bump `formatVersion` and `project.version`,
   - a pure migration function `migrate_vN_to_vN+1(project)` in `src/document/migrations/`,
   - a **golden fixture** `fixtures/lumengrab/vN+1-*.lumengrab` plus the previous fixtures kept as is,
   - a test that opens every fixture, migrates to latest, validates with Zod, and compares against a snapshot,
   - an update to this document.
3. Additive, optional fields that old readers can safely ignore do **not** need a version bump, but must be listed here.
4. **Unknown fields are preserved** on load and written back on save (use passthrough / keep an `extra` bag). Never silently drop data.
5. Opening a file with `minReaderVersion` higher than the app supports: open **read-only**, show a clear message ("File version N · LumenGrab supports up to M"), offer "Export as PNG" (only where it is safe, see section 7). A read-only file is viewed from `manifest.json` and `preview.png`; its `project.json` may not fit this version's schema and is then not used at all. It can never be saved.
   A file whose `formatVersion` is newer but whose `minReaderVersion` is not higher than the app supports is **editable**: it is validated with the current schema, unknown fields are preserved, and `project.version` and the manifest versions are written back as they were.
   A file upgraded by migration (its `formatVersion` was lower than the app's) is written with the app's version as `formatVersion` **and** `minReaderVersion`: an old app cannot be trusted to read it.
6. Migrations only go **forward**. Files are upgraded in memory on open; the file on disk is rewritten only when the user saves.
7. Never delete or edit existing golden fixtures.

## 6. Reading and writing

**Read:**
1. Open ZIP, enforce limits (section 2).
2. Parse `manifest.json`, check `format === "lumengrab"`, check `minReaderVersion`.
3. Parse `project.json`, run migrations to latest, validate with Zod.
4. Load `source.png`; read its size from the PNG header (limit check) before anything decodes it; verify `sha256` and dimensions against the manifest. On mismatch show a warning but still open.
5. Resolve asset references. A missing asset falls back to a neutral background and shows a notice, no crash. An asset whose content does not match the SHA-256 in its name, an unknown `fontId`, and a missing `preview.png` are warnings too. An asset name that is not a plain file name inside `assets/` counts as missing.

Warnings never stop a file from opening: `source-size`, `source-hash`, `missing-asset`, `asset-hash`, `unknown-font`, `missing-preview`.

**Write:**
1. Build all entries in memory (or a temp file).
2. Render `preview.png` from the current state (flat, redactions baked, longest edge at most 1024 px, PNG). `preview.png` is required on write; a file without one still opens (warning) and gets a new one when saved.
3. Write ZIP to a temp file next to the target, `fsync`, then **atomic rename**.
4. Keep the previous file as `.bak` until the write is confirmed (optional setting).

Autosave: editor changes autosave to a recovery location in the app data dir, not over the user's file, until the user saves.

## 7. Security and privacy

- **Redaction:** the `.lumengrab` file contains the **unredacted original** in `source.png`. This is by design (editability). Therefore:
  - Show a notice when saving or sharing a `.lumengrab` that contains redaction layers.
  - Default sharing/export (PNG/JPG/WebP/clipboard) is always **flat** with redactions baked in and pixels destroyed.
  - Pixelate uses block randomization seeded by `seed` so it cannot be reversed.
- Never execute or evaluate anything from the file. It is data only.
- **A flat export or preview must never contain the pixels under a visible redaction**, whatever the layer order. Redactions are applied to the full source image first, then the crop is taken. Blur has a minimum strength so it cannot be a no-op; solid is always opaque; pixelate uses seeded random noise per block.
- A renderer that cannot draw annotations must refuse a document with visible annotations instead of exporting it without them.
- Validate every path, size, and number (clamp NaN/Infinity, absurd coordinates).
- No network access is ever triggered by opening a file.

## 8. Fonts

- Only bundled, freely licensed fonts, referenced by `fontId` (e.g. `"inter"`, `"jetbrains-mono"`).
- Unknown `fontId` falls back to the default font and shows a one-time notice.
- Fonts are not embedded in the file in v1.
- `inter` is the variable font Inter and `jetbrains-mono` the variable font JetBrains Mono, both bundled with the app (SIL OFL-1.1). The counter number always uses `inter`.

## 9. Test requirements

Implemented: `src/document/*.test.ts` and `fixtures/lumengrab/`. The golden fixtures are `v1-minimal`, `v1-all-layers`, `v1-redactions`, `v1-unknown-fields` (v1) and `v2-groups` (nested, hidden and locked groups, a redaction inside, an unknown field on a group), each with a `.expected.json` of what a correct reader must produce; they were written by `scripts/make-fixtures.mjs` (independent of `src/document`) and are never edited. A v1 fixture opens as a v2 project: the test expects its `.expected.json` with `version` raised to the current one.

- Round-trip test: create -> save -> load -> equals original (including unknown fields).
- Golden fixtures for every released version open and migrate cleanly.
- Fuzz-style tests: truncated ZIP, bad JSON, wrong hashes, zip-slip names, oversized images, huge coordinates.
- Rendering test: flat export of a fixture matches an expected image (tolerance-based), and redacted regions provably differ from the source pixels.

## 10. Open decisions (resolve before v1 freeze)

- Trademark / conflict check for the name LumenGrab (extension `.lumengrab` is fixed).
- **Resolved:** `preview.png` stays PNG in v1.
- Whether to ship an additional optional "editable PNG" export (embedding the project into a PNG chunk). Not part of v1; would reuse the same `project.json`.
