# ADR 0007: Presentation and format v3 (M5)

Status: accepted (M5). Spec: [`docs/FORMAT.md`](../FORMAT.md) sections 4, 4b and 5.

M5 turns a screenshot into a presentation picture: background, padding, shadow, window frame, aspect ratio and social formats. The format
already had a `presentation` object (v1), but it could not say what the designs need, and it had no rules for how it looks.

## Decisions

- **Format v3, migration `v2 -> v3` is the identity.** New background types (`source-blur`), gradient `kind`, mesh `smoothness` and `points`,
  image `blur` and `dim`, frames `minimal` and `terminal` with a `theme`, and `aspect.size` / `aspect.preset`. Everything has a default when absent,
  so every older project is a valid v3 project. A v2 reader would reject an unknown background type, so new files are `formatVersion 3,
minReaderVersion 3`. Fixtures: `v3-presentation`, `v3-source-blur`, `v3-image-background`, `v3-radial-gradient`.
- **The rendering rules are part of the format (section 4b).** Canvas size, window placement, shadow, gradient geometry, mesh weights and frame metrics
  are written down in numbers, so an old file looks the same later and the editor, the export and `preview.png` cannot drift apart.
- **One drawing code, `src/presentation/`.** Pure parts (layout, gradient geometry, mesh field, blur) are tested in Node; the canvas parts
  (`draw-presentation.ts`, `frames.ts`) are tested in Chromium by probing pixels. Shadow, clipping and gradients are the canvas's; mesh and blur are our
  own pixel code, because `ctx.filter` does not exist in WebKit and the two WebViews must look the same.
- **Everything is in composition pixels, frames scale with the picture.** A Retina capture twice as wide gets a title bar twice as high (`k`), while
  padding, radius and shadow are plain pixels that a look scales when it is applied to a picture (see the looks, stage 5).
- **Social formats store the exact size.** `aspect.size` is the pixel size of the platform's recommendation; the composition is scaled to it. `preset`
  only names the choice for the editor's list and safe-area overlay. Platform sizes change over time; the file keeps the pixels it was made with.
- **`autoBalance` is an editor behaviour.** While on, the editor keeps the four paddings equal; the renderer only reads `padding`. "Balance edges"
  sets the four to their mean.
- **Not in v3:** film grain and animated (shader) backgrounds. Animated backgrounds are a later format version (M5b).
- **Looks are a separate store, not part of the document.** A look holds only the parts it was made with (background, padding, radius, shadow, frame, aspect), lengths for a picture
  1280 px wide and scaled to the picture it is applied to. They live in `looks.json` in the app's config folder with their pictures as files (`looks/assets/<sha256>.<ext>`); Rust only stores text and
  bytes, TypeScript validates every look on its own (one broken look never costs the others). The default look is a copy, so deleting a saved look does not change it. A picture that a look needs is
  copied into the document when the look is applied (and pruned from `assets/` on save when nothing uses it).
- **The automatic look runs in a hidden page, not in Rust.** A new capture is handed to a warm hidden window (`?window=present`) that draws the default look with the editor's own code and answers with the PNG
  (`present_request` / `present_take` / `present_result`). Rust waits at most six seconds; on any failure the capture goes out as it was, with a "Could not apply your look" card and Try again. The original is kept
  as `originals/<same name>.png` for 30 days; Edit opens it and applies the look as a presentation, so nothing is framed twice. The page exists only while the setting is on.
- **Settings (Rust):** `presentation.auto` and `presentation.openInPresentation`; the look itself is not in `settings.json`.
