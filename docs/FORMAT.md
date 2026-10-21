# `.lumengrab` File Format Specification

Status: **v4, implemented in `src/document/` (v1: M3, v2 adds the `group` layer: M4, v3 adds the presentation features: M5, v4 adds the shader background: M5b)** · Extension: `.lumengrab` · Source of truth for the document model.

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

## 4. `project.json` (v4)

All geometry is in **source-image pixel space** (origin top-left, y down). Colors are hex `#RRGGBB` or `#RRGGBBAA`. Angles in degrees. IDs are short unique strings (1 to 64 characters).

`Pt` is `{ x: number; y: number }` and `Rect` is `{ x: number; y: number; width: number; height: number }`.

Numbers must be finite. A coordinate or length beyond +-1 000 000 is **clamped** to that value when the file is read; negative widths, heights, stroke widths and similar lengths are invalid. Opacities, `smoothing` and gradient offsets are 0 to 1.

```ts
// Reference types. Implement as Zod schemas in src/document/schema.ts
type Project = {
  version: 4
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

// v3 and v4 added what is marked "v3" and "v4". A field marked "absent = x" means that x is used when the field is not there.
type Presentation = {
  enabled: boolean                    // false: the picture is exported as it is, the rest is kept
  background:
    | { type: "solid"; color: string }
    | { type: "gradient"; kind?: "linear" | "radial" /* v3, absent = linear */; angle: number; stops: { offset: number; color: string }[] }
    | { type: "mesh"; seed: number; colors: string[];
        smoothness?: number           // v3, 0..1, absent = 0.7
        points?: [number, number][] } // v3, one per colour, each 0..1 of the canvas; absent = the seeded default layout
    | { type: "image"; asset: string; fit: "cover" | "contain";   // asset = file name in assets/
        blur?: number; dim?: number } // v3, blur radius in pixels (absent = 0), black over it 0..1 (absent = 0)
    | { type: "source-blur"; blur: number; zoom: number; dim: number; saturation: number }  // v3: the picture itself, enlarged and blurred
    | ShaderBackground                // v4: a background that moves, section 4c
    | { type: "transparent" }
  padding: { top: number; right: number; bottom: number; left: number }
  autoBalance: boolean                // the editor keeps the four paddings equal while on; the renderer only reads `padding`
  cornerRadius: number
  shadow: { enabled: boolean; x: number; y: number; blur: number; spread: number; color: string }
  frame: {
    type: "none" | "macos-window" | "windows-window" | "browser" | "minimal" | "terminal"  // v3 adds minimal, terminal
    theme?: "light" | "dark"          // v3, absent = light; a terminal is always dark
    title?: string
    url?: string
  }
  aspect: {
    mode: "free" | "fixed"
    ratio?: [number, number]
    size?: [number, number]           // v3: export at exactly this many pixels (a social format); its shape wins over `ratio`
    preset?: string                   // v3: the preset the user picked (list and safe area in the editor); never used for drawing
  }
  exportScale: number
}

// v4. Layers and effects drawn by WebGL; the rules are section 4c.
type ShaderBackground = {
  type: "shader"
  engine: number                      // version of the rendering rules (section 4c); this reader draws 1
  loop: number                        // seconds until the motion is back at its start, 1 to 60
  poster: number                      // the moment, in seconds, every still picture shows, 0 to 60
  seed: number                        // whole number, 0 to 4294967295
  palette: string[]                   // 1 to 8 colours the layers paint with
  fallback: string                    // drawn below the first layer, and everywhere if WebGL is not there
  layers: ShaderLayer[]               // bottom first, at most 16
}
type ShaderLayer = {
  id: string
  kind: string                        // a kind of section 4c, or "custom"
  enabled: boolean
  name?: string
  opacity: number                     // 0..1
  blend: "normal" | "add" | "screen" | "multiply" | "overlay" | "soft-light"
  speed: number                       // whole cycles of the motion per loop, 0 to 32
  direction?: "right" | "left" | "up" | "down"  // which way the motion travels, absent = right
  seed?: number                       // absent = the seed of the background
  params: Record<string, number | boolean | string | (number | string | { offset: number; color: string })[]>
  role?: "generator" | "effect"       // custom only
  code?: string                       // custom only: a WebGL 1 fragment shader (GLSL ES 1.00), at most 16 384 characters
}
```

Notes:
- **A layer whose `type` this version does not know is kept as an opaque layer**: it is preserved with all its fields, written back, and never drawn. A layer of a known type with invalid fields is an error (the file is rejected with the field named), it is not downgraded to an opaque layer.
- `visible: false` layers are not rendered, redactions included. Everything else about a layer is preserved.
- **Groups (v2).** A group sits in the z-order of its parent like any layer and draws its children in order at that place. A hidden group hides everything inside it, **redactions included**. A locked group locks everything inside it (the editor does not select or change those layers). Groups are not drawn themselves: they have no geometry. The limit of 5000 layers counts every layer of the tree, groups included. Nesting deeper than 8 groups is an error (the file is rejected with the path of the group, e.g. `layers.1.layers.0`).
- **Redactions inside groups are baked like any other** (section 7): the renderer collects them depth first, skips those with a hidden layer or group around them, and applies them to the full source image before anything is drawn.
- `source-blur` is a `zoom` of 1 to 4, a `saturation` of 0 to 3, `dim` 0 to 1 and a `blur` radius of 0 or more pixels. A `mesh` has 1 to 16 colours; `points` has none or as many entries as `colors` (otherwise the default layout is used). A `gradient` has 2 to 16 stops. `aspect.size` sides are whole numbers from 1 to 16 384.
- A new document starts with `crop: null`, no layers, and this presentation: `enabled: false`, solid `#F4F4F5`, padding 64 on every side, `autoBalance: true`, `cornerRadius: 12`, shadow on (`x 0, y 20, blur 50, spread 0, #00000040`), frame `none`, aspect `free`, `exportScale: 1`.
- A shader background has at most 16 layers, 8 palette colours, 64 settings per layer, a loop of 1 to 60 seconds, and 16 384 characters of code per layer and 65 536 in all. A layer whose `kind` this version does not know is kept with all its settings and is not drawn; the settings of a known kind that are missing take their default and those out of range are clamped when it is drawn, never rejected.
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

## 4b. Presentation rendering rules (normative, v3)

These rules say how `presentation` looks when `enabled` is true. They are as binding as 4a: a change is a format change. **All lengths are pixels of the composition, i.e. of the finished picture before it is scaled for output.** The editor, the preview, the export, `preview.png` and the automatic look use the same drawing code (`src/presentation/`).

**Order.** The picture is first made exactly as in 4a (redactions, annotations, crop). Then: (1) the background fills the canvas, (2) the shadow, (3) the window (title bar and picture), clipped by the corner radius, (4) the result is scaled for output. An `enabled: false` presentation changes nothing.

**Layout.** Let `W x H` be the picture. A frame adds a title bar of `bar` pixels above it (`bar = round(base x k)`, `k = clamp(W / 1280, 0.5, 4)`, `base`: macOS 40, Windows 36, browser 52, minimal 24, terminal 36, none 0). The window is `W x (H + bar)`. The canvas is the window plus the four paddings. If a shape is wanted (`aspect.size` gives it as `size[0] / size[1]`, otherwise `mode: "fixed"` gives `ratio[0] / ratio[1]`), the canvas is made wider or taller until it has that shape and is **never made smaller**; the window stays centred in the extra space (an uneven padding keeps its unevenness). The canvas size is rounded to whole pixels.
**Output.** With `aspect.size` the output is exactly that size (the composition is scaled by `size[0] / canvas width`). Without it the output is the canvas times `exportScale`, rounded; if its longest side would exceed 16 384 pixels the scale is reduced so it does not.

**Corner radius.** The window (title bar included) is clipped to a rounded rectangle; the radius is at most half the shorter side.

**Shadow.** The window's rounded rectangle, grown by `spread` on each side (radius + `spread`, never negative), moved by `x, y`, filled with `color` and blurred with a gaussian of standard deviation `blur / 2` (the CSS `box-shadow` rule). Only the shadow is drawn, not the shape; the window is drawn over it.

**Backgrounds.**
- *solid*: the colour.
- *gradient*: stops are sorted by `offset` (equal offsets keep their order) and the colours are interpolated in sRGB. `linear`: the CSS rule. 0° points up, the angle turns clockwise, the line goes through the centre of the canvas and is `|W sin a| + |H cos a|` long (the corners get the first and last colour). `radial`: a circle around the centre of the canvas that reaches the farthest corner; offset 0 is the centre. `angle` is not used by `radial`.
- *mesh*: `n` colours sit at `n` points (`points`, or the default layout). Default layout: the colours are laid on a lattice of `cols = ceil(sqrt(n))` columns and `ceil(n / cols)` rows covering the whole canvas (`x = col / (cols - 1)`, `0.5` for one column; the same for `y`). The mulberry32 generator of the seed (the one of the pixelate redaction, `seededRandom` in `src/document/render/pixels.ts`) is asked for two numbers per point, in order; each becomes an offset in `[-1, 1]` times `0.35 / (cols - 1)` (`/ (rows - 1)` for `y`; `/ 1` for a single column or row) added to the point's `x` and `y`, except that a point on the left or right edge keeps its `x` and a point on the top or bottom edge keeps its `y`. Every sample of the field is the average of the colours weighted by `1 / (d² + 0.004)^q` with `d` the distance to the point in canvas units (0 to 1 on each axis, no aspect correction) and `q = 1 + 3 x (1 - smoothness)`. The field has `round(side / 8)` samples per side (8 to 256) and is scaled up to the canvas smoothly.
- *image*: the asset, `cover` (fills the canvas, centred, cropped) or `contain` (fits inside, centred; the rest stays transparent). `blur` is a gaussian blur of standard deviation `blur / 2`; `dim` lays black of that opacity over it. A missing or undecodable asset gives a plain `#F4F4F5`.
- *source-blur*: the finished picture (without frame), laid over the canvas as `cover` and enlarged by `zoom`, blurred with standard deviation `blur / 2` (edges clamped, no fade at the border), the saturation multiplied by `saturation` (luma weights 0.2126, 0.7152, 0.0722), then darkened by `dim`.
- *transparent*: nothing is drawn; a flat export to JPG puts it on white.
The blurs are done at a reduced size and scaled back, so they differ from an exact gaussian by a few levels; the format only promises "looks the same".

**Window frames** (all lengths times `k`; colours are fixed; `light` / `dark`: title bar `#F2F2F4` / `#2A2A2E`, hairline `#D9D9DE` / `#3A3A40`, text `#4B5563` / `#A1A1AA`, address field `#FFFFFF` / `#1B1B1E`; a terminal uses `#1F1F23`, `#34343A`, `#A1A1AA`). The bar ends in a hairline of `max(1, k)` pixels.
- *macos-window*: three dots (`#FF5F57`, `#FEBC2E`, `#28C840`), radius 6, centres at `x = 20, 40, 60`; the title centred, Inter 500, size 13, at most the width minus 160.
- *windows-window*: the title left at 14, Inter 500, size 12; minimise, maximise and close glyphs (5 half-size, stroke `max(1, k)`) centred in three cells of 46 at the right edge.
- *browser*: three dots of radius 5 as in macOS; an address field from `x = 96` to `W - 96`, 28 high and fully rounded, containing the `url` (or `title`) centred, Inter 400, size 13; no field if it would be narrower than 120.
- *minimal*: three dots of radius 4, centres at `x = 14, 28, 42`, in a neutral grey (`#C7C7CC` / `#55555B`), no text.
- *terminal*: dark whatever `theme` says; like macOS, with the title in JetBrains Mono 400, size 12.
Text that does not fit is cut with an ellipsis. A font that cannot be loaded falls back to the system font.

## 4c. Shader background rendering rules (normative, v4)

A `shader` background is drawn by WebGL 1 with **engine 1**. These rules are as binding as 4a and 4b; a change to how a kind looks is a new engine version (`engine` is written into every scene so an old file keeps its engine). A reader that is given `engine` higher than it knows still draws what it can and says so.

The GLSL of the built-in kinds in `src/shader/glsl.ts` is the reference for their look. **Pictures from different graphics cards match visually, not bit for bit** (the cards round differently); golden-picture tests use a tolerance. The noise is built from a hash that uses only `fract`, multiplications and additions of small numbers (no `sin` of a large number, whose result differs between graphics cards and made the noise pop where its cells meet); the engine's hash was changed that way in 0.1.1, which changed the pictures of noise based looks slightly, never their settings. Ranges of `smoothstep` always run from the smaller to the larger edge.

**Time.** A moment `t` in seconds is `phase = (t / loop) mod 1`, 0 up to (not including) 1. Every layer gets `a = 2 pi x s x phase` and `ph = fract(s x phase)` with `s = speed` (negative when `direction` is `left` or `down`), `speed` a whole number. All motion is built from whole turns of `a` or whole steps of `ph`, so the picture at `t = loop` is the picture at `t = 0`. A layer with `speed` 0 stands still. `up` and `down` also swap the x and y axes of a built-in kind (`centered()` and `extent()` in its shader), so what travelled sideways travels up or down. Stills (export, copy, `preview.png`, the automatic look, "Use this frame as picture") show `t = poster`, clamped into the loop. A video or GIF shows `t = i / fps` for frame `i`.

**Order.** The picture below the first layer is the `fallback` colour, opaque. Each enabled layer of a known kind is drawn in order, bottom first, and laid over the result: a **generator** draws a colour and an alpha by itself; an **effect** reads the picture below it (as `u_input`) and gives a colour; its alpha is 1. The layer's result `s` with alpha `a` is laid over `d` as `d' = mix(d, B(d, s), a x opacity)`. The picture stays opaque. `B` is `normal`: `s`; `add`: `min(d + s, 1)`; `screen`: `1 - (1 - d)(1 - s)`; `multiply`: `d s`; `overlay`: `2 d s` where `d < 0.5`, otherwise `1 - 2(1 - d)(1 - s)`; `soft-light`: the W3C formula. Colours are in sRGB, not linear. A layer that is `enabled: false`, of a kind this reader does not know, or a `custom` layer without code, is skipped.

**Coordinates and size.** The picture is drawn at the size of the canvas of section 4b (at most 4096 pixels on the long side, then scaled up smoothly). `y` points up in the shaders. A built-in kind works in units of the short side of the picture, centred; an `px` setting is in pixels of a picture 1280 pixels wide and scales with the width. A scene therefore looks the same at every size.

**Colours.** A built-in kind paints with the first `k` colours of `palette` (`k` is 1 to 4 for most kinds, the whole palette for `orbs` and `waves`); with `source: "custom"` its last colour is `highlight`. A custom shader sees the whole palette as `u_palette[8]`, the palette repeated to fill eight.

**Kinds and settings** (a setting is `params.<id>`; the value is clamped into the range; the default is used when it is absent):

| kind | role | settings (default, range) |
|---|---|---|
| `gradient` | generator | `type` linear / radial / conic / diamond (linear), `angle` 150 (0 to 360), `stops` 2 to 8 `{offset, color}` sorted by offset (the alpha of a colour counts). `speed` turns a linear or conic gradient round, and lets a radial or diamond one breathe by 12 %. |
| `orbs` | generator | `count` 5 (2 to 12), `size` 0.5 (0.2 to 1.2), `softness` 0.6, `spread` 0.5 (0 to 1), `source`, `highlight` |
| `aurora` | generator | `scale` 1.2 (0.3 to 4), `rotation` 35 (-180 to 180), `offsetX` 0.1, `offsetY` -0.05 (-1 to 1), `source`, `highlight` |
| `waves` | generator | `count` 5 (2 to 12), `amplitude` 0.6, `frequency` 2 (0.5 to 8), `rotation` 0, `softness` 0.15, `source`, `highlight` |
| `liquid` | generator | `scale` 1.6 (0.3 to 6), `warp` 1 (0 to 2), `detail` 3 (1 to 5), `rotation` 0, `source`, `highlight` |
| `cells` | generator | `scale` 8 (2 to 40), `softness` 0.5, `jitter` 1, `edges` false, `source`, `highlight` |
| `ripples` | generator | `centerX` 0.5, `centerY` 0.5, `spacing` 0.12 (0.03 to 0.5), `thickness` 0.4, `fade` 0.5, `source`, `highlight` |
| `pattern` | generator | `shape` stripes / grid / dots, `scale` 14 (2 to 60), `angle` 30 (-90 to 90), `thickness` 0.35, `softness` 0.1, `source`, `highlight` |
| `rays` | generator | `count` 12 (3 to 40), `originX` 0.5, `originY` 1.1 (-0.5 to 1.5), `spread` 0.6, `softness` 0.6, `falloff` 0.5, `source`, `highlight` |
| `stars` | generator | `density` 0.5, `size` 1 (0.3 to 3), `twinkle` 0.6, `drift` 0.3, `source`, `highlight` |
| `solid` | generator | `color` |
| `warp` | effect | `amount` 0.4, `scale` 2 (0.3 to 6) |
| `swirl` | effect | `amount` 0.6 (-2 to 2), `radius` 0.6 (0.05 to 1.5), `centerX` 0.5, `centerY` 0.5 |
| `chromatic` | effect | `amount` 6 px (0 to 60), `angle` 0 (0 to 360) |
| `pixelate` | effect | `size` 12 px (2 to 200), `square` true, `amount` 1, `animate` false |
| `posterize` | effect | `levels` 5 (2 to 16), `amount` 1 |
| `vignette` | effect | `amount` 0.4, `softness` 0.5, `roundness` 0.5 |
| `grain` | effect | `amount` 0.3, `size` 1.2 px (0.5 to 6), `animate` false (when true, the grain changes 12 times per cycle of `speed`; a still grain does not flicker, so it is the default) |
| `glow` | effect | `threshold` 0.6, `radius` 0.06 (0.005 to 0.2), `intensity` 0.8 (0 to 2) |
| `grade` | effect | `brightness` 0 (-100 to 100), `contrast` 0 (-100 to 100), `saturation` 1 (0 to 3), `hue` 0 (-180 to 180), `tint`, `tintAmount` 0 |

Settings written 0 to 1 have that range unless another is given. `kind: "custom"` is the next paragraph; any other `kind` is unknown.

**Custom shaders.** A `custom` layer has `role` (`generator`, the default, or `effect`), its `code`, and `params` for the settings the code asks for. The code is **one WebGL 1 fragment shader, GLSL ES 1.00**, at most 16 384 characters, with no `#extension`, `#version`, `#include` or `#pragma`, and loops that run at most 256 times (WebGL 1 allows only loops with a constant count). It is compiled as `precision mediump float;`, LumenGrab's helpers, `#line 1` and the code, so an error is reported with the line of the code. The code may declare and read these uniforms: `vec2 u_resolution` (pixels), `float u_phase` (the phase, 0 up to 1), `float u_seed` (the seed of the layer, `seed mod 1048576`), `vec3 u_palette[8]`, `float u_palette_count` (how many of the eight are the palette; the rest repeat it) and, for an effect, `sampler2D u_input` (the picture below). It may call `noise(vec2)`, `fbm(vec2)`, `hsv2rgb(vec3)` and `rot(float)` (helpers it defines itself take their place). It writes `gl_FragColor`; the alpha of an effect is ignored. A setting is a comment line `// @param float|int|color|bool name = default [min, max] "Label"` with a matching uniform of the same name (`float`, `vec3` for a colour, `bool`); its value is `params.<name>`. The code **cannot read the screenshot or anything else**: it has no inputs but these. To loop without a jump it must use whole numbers of turns of `u_phase`.
Code that does not compile, is too long or fails the checks is not drawn (the layer is skipped; the editor shows the reason). **A file never runs its code by itself**: the code of a `.lumengrab` that came from outside runs only after the user allows it (the allowance is kept by the app per document id, never in the file). Code the user wrote in this app runs. A layer that makes a frame slower than 250 milliseconds is switched off (`enabled: false`) and the user is told.

**Where WebGL is missing.** The background is the `fallback` colour. The scene is kept untouched and is drawn normally on another computer.

**Frozen frames.** "Use this frame as picture" renders the still of the scene at the canvas size of 4b (at most 3840 on the long side) into an asset PNG and changes the background to `image` (`fit: cover`); it is an ordinary v3 background and needs no WebGL.

## 5. Versioning and migrations (mandatory process)

1. `manifest.formatVersion` and `project.version` are integers that start at 1. **v2** added the `group` layer. Every v1 project is a valid v2 project, so the migration `v1 -> v2` changes nothing but the version. A v1 reader would see a group as an unknown layer, not draw its children and so export a redaction inside it unredacted, so it must not open such a file for editing. **v3** added the presentation features (new background types, frames, social sizes, section 4b) with a default for everything that is absent; the migration `v2 -> v3` is the identity as well. A v2 reader rejects a background type it does not know, so new files are written with `formatVersion 3` and `minReaderVersion 3`. **v4** added the `shader` background (section 4c); `v3 -> v4` is the identity and, as for v3, an older reader rejects the new type, so files are written with `formatVersion 4` and `minReaderVersion 4`.
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
2. Render `preview.png` from the current state (the finished picture: redactions baked, annotations drawn, crop taken and, when the presentation is on, section 4b applied; longest edge at most 1024 px, PNG). `preview.png` is required on write; a file without one still opens (warning) and gets a new one when saved.
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

- **Bundled fonts** are referenced by `fontId`: `inter`, `jetbrains-mono`, `lora`, `fraunces`, `space-grotesk`, `oswald`, `nunito`, `caveat`. They are variable fonts shipped with the app (SIL OFL-1.1), so a file looks the same on every device.
- **Installed fonts (v2, additive).** A text layer may name a font installed on the user's device as `fontId: "system:<family name>"` (for example `system:Avenir Next`). The file stores only the name, never the font. On a device that has the font the text looks as it did; on a device without it the **default font (Inter) is used** and the editor says so once ("The font … is not installed on this device"). The text, its size and its box are kept either way, but line breaks may differ because the metrics of the fonts differ. Flat exports are made on the device that has the font and are always right.
- An unknown `fontId` that is neither a bundled id nor a `system:` name falls back to the default font and shows a one-time notice (`unknown-font`).
- Fonts are not embedded in the file in v1 or v2.
- `inter` is the variable font Inter and `jetbrains-mono` the variable font JetBrains Mono. The counter number always uses `inter`.

## 9. Test requirements

Implemented: `src/document/*.test.ts` and `fixtures/lumengrab/`. The golden fixtures are `v1-minimal`, `v1-all-layers`, `v1-redactions`, `v1-unknown-fields` (v1) `v2-groups` (nested, hidden and locked groups, a redaction inside, an unknown field on a group) and, for v3, `v3-presentation` (mesh with points, per-side padding, a terminal frame, a social size), `v3-source-blur` (blurred screenshot, browser frame, 1.91:1 size), `v3-image-background` (image with blur and dim, minimal frame, an unknown field) `v3-radial-gradient` (radial gradient with a transparent stop, Windows frame) and, for v4, `v4-shader` (gradient, aurora with its own colour and seed, a hidden layer, a layer with code and its settings, grain, a kind this version does not know and an unknown field on the scene) and `v4-frozen-frame` (a frozen frame stored as an image background), each with a `.expected.json` of what a correct reader must produce; they were written by `scripts/make-fixtures.mjs` (independent of `src/document`) and are never edited. An older fixture opens as a project of the current version: the test expects its `.expected.json` with `version` raised to the current one.

- Round-trip test: create -> save -> load -> equals original (including unknown fields).
- Golden fixtures for every released version open and migrate cleanly.
- Fuzz-style tests: truncated ZIP, bad JSON, wrong hashes, zip-slip names, oversized images, huge coordinates.
- Rendering test: flat export of a fixture matches an expected image (tolerance-based), and redacted regions provably differ from the source pixels.

## 10. Open decisions (resolve before v1 freeze)

- Trademark / conflict check for the name LumenGrab (extension `.lumengrab` is fixed).
- **Resolved:** `preview.png` stays PNG in v1.
- Whether to ship an additional optional "editable PNG" export (embedding the project into a PNG chunk). Not part of v1; would reuse the same `project.json`.
