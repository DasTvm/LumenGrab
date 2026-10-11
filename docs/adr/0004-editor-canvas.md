# ADR 0004: The editor canvas is a plain 2D canvas with our own drawing code (M4)

Status: accepted (M4). Replaces "Editor canvas: Konva.js (react-konva)" of the first stack table in `AGENTS.md`.

## Decision

The editor draws the picture and every layer on **one `<canvas>`** with `drawLayers` (`src/editor/draw/draw.ts`), the very function that renders
the preview, the export and the clipboard. Hit testing, handles, resizing, rotating and the marquee are pure TypeScript in `src/editor/model/geometry.ts`
and `src/editor/ui/selection.ts`; the handles are an SVG on top of the canvas. State is `zustand` + `immer` (patch-based undo).
**Konva and react-konva are not used.**

## Why

- The plan was to use Konva only for hit testing, selection and handles, and to draw through `Shape.sceneFunc`. Those are the parts that carry our
  rules (what counts as a hit on an unfilled rectangle, how a rotated box resizes around a fixed corner, how an arrow bends). We needed them as
  pure functions anyway so Vitest can test them in plain Node, which left Konva as a second scene graph holding a copy of the document.
- One drawing function for the screen and for every export is the strongest guarantee that "what you see is what you export". With Konva there would be a
  second place (its shapes, its transforms, its text layout) that could drift from the export path.
- Fewer dependencies (AGENTS.md section 2) and no Konva-specific text engine: text layout is ours (`draw/text.ts`) and lives in the file format's rendering rules.

## Consequences

- The canvas redraws the whole scene when a layer changes. The base picture (with redactions baked into the pixels by the export's own functions) is
  cached in `BaseImage` and rebuilt only when a redaction changes; annotations are cheap vector drawing.
- We own pointer handling (`select-tool.ts` and the tools of the next stages), zoom and pan (`view.ts`).
