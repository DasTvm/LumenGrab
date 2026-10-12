# presentation

Backgrounds, frames and layout (M5, docs/FORMAT.md section 4b). One drawing code for the editor's Presentation mode, the export, `preview.png` and the
automatic look.

- `compose.ts`: layout maths (canvas, window, output size), pure.
- `gradient.ts`, `mesh.ts`, `blur.ts`, `color.ts`: pure pixel and geometry functions, tested in Node.
- `frames.ts`, `draw-presentation.ts`: canvas drawing (shadow, clip, frame chrome, backgrounds), tested in Chromium (`e2e/presentation-render.spec.ts`).
