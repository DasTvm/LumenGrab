# ADR 0009: Animated shader backgrounds and format v4 (M5b)

Status: accepted (M5b). Spec: [`docs/FORMAT.md`](../FORMAT.md) sections 4, 4c and 5.

M5b adds backgrounds that move: layers and effects drawn by WebGL, a Background Studio to build them, a shader editor for your own code, a still frame
for every picture that leaves the app, and loops as MP4, WebM or GIF.

## Decisions

- **Format v4, migration `v3 -> v4` is the identity.** One new background type, `shader`. As with v3, an older reader rejects an unknown background type, so new files are
  `formatVersion 4, minReaderVersion 4`. Fixtures: `v4-shader`, `v4-frozen-frame`.
- **The file holds a scene, not a shader.** A scene is a list of layers (kind, blend, opacity, whole cycles of speed, settings) plus a palette, a seed, a loop length and a
  still-frame moment. The kinds are described once in `src/shader/kinds.ts`; the Inspector and the renderer are both made from that description. The GLSL of the built-in kinds is
  ours (`src/shader/glsl.ts`) and is the reference for how a kind looks. Looks, the default look and `.lumengrab` files store scenes in the same shape.
- **Loops close by construction.** Every motion is a whole number of turns of one angle (`u_a`) or whole steps of one fraction (`u_ph`), so frame `loop` equals frame 0 for every kind and
  every speed. Tests check this for each kind in Chromium. `speed` is therefore "cycles per loop", an integer.
- **Passes, not one big shader.** Each layer is drawn into a texture and laid over the picture below it (blend mode, opacity); an effect reads the picture below as `u_input`. This is what makes
  effects (warp, swirl, pixelate, glow) and effects written by users possible, and it keeps each kind's shader small. Programs are cached per kind or per code, so a slider changes uniforms only.
- **WebGL 1 and GLSL ES 1.00 for everything.** The shader editor teaches one dialect, built-in layers and layers you write run the same way, and WebGL 1 exists everywhere our WebViews do.
  WebGL 1 also only allows loops with a constant count, which is the first guard against runaway code.
- **Custom code is data that a user may run, so it is gated.** The shader has no inputs but ours (it cannot read the screenshot), it passes text checks (size, no `#extension`/`#version`, short loops),
  a frame that takes longer than 250 ms switches the layer off, and code from a file that came from outside does not run until the user allows it. The allowance is kept by the app per document id
  (a small file in the app folder), never in the `.lumengrab`. A graphics-driver hang cannot be ruled out from JavaScript; the gate means a foreign file can never start one without a click.
- **Stills match visually, not bit for bit.** Graphics cards round differently. The format says so; golden-picture tests use a tolerance.
- **Where WebGL is missing,** the background is the scene's fallback colour and the scene is kept. "Use this frame as picture" turns an animation into an ordinary image background that needs no WebGL.
- **Video and GIF are encoded in the app.** WebCodecs for MP4 and WebM, GIF as the fallback (see the export stage); nothing is sent anywhere.
- **Not in v4:** audio, animated WebP, video inside the `.lumengrab`, passing the screenshot into a shader.
