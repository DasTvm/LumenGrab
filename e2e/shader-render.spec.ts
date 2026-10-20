import { mkdirSync, writeFileSync } from "node:fs";
import { expect, test, type Page } from "@playwright/test";
import type * as Custom from "../src/shader/custom";
import type * as Kinds from "../src/shader/kinds";
import type * as Renderer from "../src/shader/renderer";
import type * as Scenes from "../src/shader/scenes";
import type * as Scene from "../src/shader/scene";

// The shader backgrounds are drawn by WebGL, so they are checked in Chromium (software WebGL in CI):
// every layer kind draws, a loop closes, custom code compiles or reports its line.
// Set SHADER_DUMP=/some/folder to also keep the pictures that are drawn, to look at them.
const DIR = process.env["SHADER_DUMP"] ?? "";
if (DIR) mkdirSync(DIR, { recursive: true });

interface Frame {
  width: number;
  height: number;
  /** Mean of each colour channel. */
  mean: number[];
  /** Standard deviation of the luma over the picture (0 = a flat picture). */
  spread: number;
  png: string;
  statuses: Record<string, string>;
  drawn: boolean;
}

async function frame(
  page: Page,
  scene: unknown,
  seconds: number,
  w = 320,
  h = 180,
): Promise<Frame> {
  return page.evaluate(
    async ({ scene: input, seconds: at, w: width, h: height }) => {
      const load = async <T>(path: string): Promise<T> =>
        (await import(/* @vite-ignore */ path)) as T;
      const { ShaderRenderer } = await load<typeof Renderer>("/src/shader/renderer.ts");
      const renderer = new ShaderRenderer();
      const report = renderer.render(input as never, at, width, height);
      const read = document.createElement("canvas");
      read.width = renderer.canvas.width;
      read.height = renderer.canvas.height;
      const ctx = read.getContext("2d", { willReadFrequently: true });
      if (!ctx) throw new Error("no 2d");
      ctx.drawImage(renderer.canvas, 0, 0);
      const { data } = ctx.getImageData(0, 0, read.width, read.height);
      const mean = [0, 0, 0];
      const lumas: number[] = [];
      for (let i = 0; i < data.length; i += 4) {
        mean[0] = (mean[0] ?? 0) + (data[i] ?? 0);
        mean[1] = (mean[1] ?? 0) + (data[i + 1] ?? 0);
        mean[2] = (mean[2] ?? 0) + (data[i + 2] ?? 0);
        lumas.push(
          0.2126 * (data[i] ?? 0) + 0.7152 * (data[i + 1] ?? 0) + 0.0722 * (data[i + 2] ?? 0),
        );
      }
      const n = lumas.length;
      const m = lumas.reduce((a, b) => a + b, 0) / n;
      const spread = Math.sqrt(lumas.reduce((a, b) => a + (b - m) ** 2, 0) / n);
      const statuses: Record<string, string> = {};
      for (const [id, s] of Object.entries(report.layers))
        statuses[id] = s.state === "error" ? `error:${s.message}@${String(s.line)}` : s.state;
      const png = read.toDataURL("image/png");
      renderer.dispose();
      return {
        width: read.width,
        height: read.height,
        mean: mean.map((v) => v / n),
        spread,
        png,
        statuses,
        drawn: report.drawn,
      };
    },
    { scene, seconds, w, h },
  );
}

async function diff(page: Page, sceneA: unknown, secA: number, sceneB: unknown, secB: number) {
  const a = await frame(page, sceneA, secA, 160, 90);
  const b = await frame(page, sceneB, secB, 160, 90);
  return page.evaluate(
    async ({ a: pa, b: pb }) => {
      const decode = async (url: string) => {
        const img = new Image();
        img.src = url;
        await img.decode();
        const c = document.createElement("canvas");
        c.width = img.width;
        c.height = img.height;
        const ctx = c.getContext("2d", { willReadFrequently: true });
        if (!ctx) throw new Error("no 2d");
        ctx.drawImage(img, 0, 0);
        return ctx.getImageData(0, 0, c.width, c.height).data;
      };
      const da = await decode(pa);
      const db = await decode(pb);
      let sum = 0;
      for (let i = 0; i < da.length; i += 4) {
        sum += Math.abs((da[i] ?? 0) - (db[i] ?? 0));
        sum += Math.abs((da[i + 1] ?? 0) - (db[i + 1] ?? 0));
        sum += Math.abs((da[i + 2] ?? 0) - (db[i + 2] ?? 0));
      }
      return sum / (da.length / 4) / 3;
    },
    { a: a.png, b: b.png },
  );
}

const save = (name: string, f: Frame) => {
  if (DIR) writeFileSync(`${DIR}/${name}.png`, Buffer.from(f.png.split(",")[1] ?? "", "base64"));
};

test("WebGL draws in this browser", async ({ page }) => {
  await page.goto("/");
  const ok = await page.evaluate(async () => {
    const load = async <T>(path: string): Promise<T> =>
      (await import(/* @vite-ignore */ path)) as T;
    const { webglAvailable } = await load<typeof Renderer>("/src/shader/renderer.ts");
    return webglAvailable();
  });
  expect(ok).toBe(true);
});

test("asking for WebGL again and again does not take the contexts of the renderers away", async ({
  page,
}) => {
  await page.goto("/");
  const drawn = await page.evaluate(async () => {
    const load = async <T>(path: string): Promise<T> =>
      (await import(/* @vite-ignore */ path)) as T;
    const { sharedRenderer, webglAvailable } =
      await load<typeof Renderer>("/src/shader/renderer.ts");
    const { ANIMATED_LOOKS } = await load<typeof Scenes>("/src/shader/scenes.ts");
    const scene = ANIMATED_LOOKS[0]?.make();
    const renderer = sharedRenderer("test");
    if (!renderer || !scene) return false;
    if (!renderer.render(scene, 1, 64, 36).drawn) return false;
    // A component that asked on every render made a new context each time; the browser then dropped the oldest.
    for (let i = 0; i < 60; i += 1) webglAvailable();
    await new Promise((resolve) => setTimeout(resolve, 200));
    return renderer.render(scene, 1, 64, 36).drawn;
  });
  expect(drawn).toBe(true);
});

test("a renderer whose context is gone for good builds a new one and draws again", async ({
  page,
}) => {
  await page.goto("/");
  const result = await page.evaluate(async () => {
    const load = async <T>(path: string): Promise<T> =>
      (await import(/* @vite-ignore */ path)) as T;
    const { ShaderRenderer } = await load<typeof Renderer>("/src/shader/renderer.ts");
    const { ANIMATED_LOOKS } = await load<typeof Scenes>("/src/shader/scenes.ts");
    const scene = ANIMATED_LOOKS[0]?.make();
    if (!scene) return null;
    const renderer = new ShaderRenderer();
    const before = renderer.render(scene, 1, 64, 36).drawn;
    const gl = renderer.canvas.getContext("webgl");
    gl?.getExtension("WEBGL_lose_context")?.loseContext();
    const during = renderer.render(scene, 1, 64, 36).drawn;
    await new Promise((resolve) => setTimeout(resolve, 600));
    const after = renderer.render(scene, 1, 64, 36).drawn;
    return { before, during, after };
  });
  expect(result).toEqual({ before: true, during: false, after: true });
});

test("every animated look draws something that is not flat, and none reports an error", async ({
  page,
}) => {
  await page.goto("/");
  const names = await page.evaluate(async () => {
    const load = async <T>(path: string): Promise<T> =>
      (await import(/* @vite-ignore */ path)) as T;
    const { ANIMATED_LOOKS } = await load<typeof Scenes>("/src/shader/scenes.ts");
    return ANIMATED_LOOKS.map((l) => l.id);
  });
  expect(names).toHaveLength(12);
  for (const id of names) {
    const scene = await page.evaluate(async (lookId) => {
      const load = async <T>(path: string): Promise<T> =>
        (await import(/* @vite-ignore */ path)) as T;
      const { ANIMATED_LOOKS } = await load<typeof Scenes>("/src/shader/scenes.ts");
      return ANIMATED_LOOKS.find((l) => l.id === lookId)?.make();
    }, id);
    const f = await frame(page, scene, 2.5, 480, 270);
    save(id, f);
    expect(f.drawn, id).toBe(true);
    expect(f.spread, `${id} is not a flat colour`).toBeGreaterThan(1.5);
    for (const [layer, status] of Object.entries(f.statuses))
      expect(status, `${id} ${layer}`).toBe("ok");
  }
});

test("every kind of layer and effect draws on its own", async ({ page }) => {
  await page.goto("/");
  const kinds = await page.evaluate(async () => {
    const load = async <T>(path: string): Promise<T> =>
      (await import(/* @vite-ignore */ path)) as T;
    const { KINDS } = await load<typeof Kinds>("/src/shader/kinds.ts");
    return KINDS.map((k) => ({ id: k.id, role: k.role }));
  });
  for (const kind of kinds) {
    const scene = await page.evaluate(async (k) => {
      const load = async <T>(path: string): Promise<T> =>
        (await import(/* @vite-ignore */ path)) as T;
      const { kindById } = await load<typeof Kinds>("/src/shader/kinds.ts");
      const { newLayer, newScene } = await load<typeof Scene>("/src/shader/scene.ts");
      const def = kindById(k.id);
      if (!def) throw new Error("kind");
      // An effect needs something below it to change.
      const layers =
        k.role === "effect"
          ? [newLayer(kindById("gradient") ?? def, "g"), newLayer(def, "fx")]
          : [newLayer(def, "l")];
      return newScene({ layers });
    }, kind);
    const f = await frame(page, scene, 1.3);
    save(`kind-${kind.id}`, f);
    expect(f.drawn, kind.id).toBe(true);
    for (const [layer, status] of Object.entries(f.statuses))
      expect(status, `${kind.id} ${layer}`).toBe("ok");
    expect(f.spread + (f.mean[0] ?? 0) + (f.mean[1] ?? 0), kind.id).toBeGreaterThan(0.5);
  }
});

test("a loop closes: the last moment is as close to the first as one step of the animation", async ({
  page,
}) => {
  await page.goto("/");
  const scene = await page.evaluate(async () => {
    const load = async <T>(path: string): Promise<T> =>
      (await import(/* @vite-ignore */ path)) as T;
    const { ANIMATED_LOOKS } = await load<typeof Scenes>("/src/shader/scenes.ts");
    const made = ANIMATED_LOOKS[0]?.make();
    // The film grain changes in steps, so it is left out of the comparison of two close moments.
    return made ? { ...made, layers: made.layers.filter((l) => l.kind !== "grain") } : made;
  });
  const loop = scene?.loop ?? 8;
  const step = loop / 240;
  const seam = await diff(page, scene, loop - step, scene, 0);
  const normal = await diff(page, scene, loop * 0.4, scene, loop * 0.4 + step);
  expect(seam).toBeLessThan(normal * 1.5 + 0.5);
  expect(await diff(page, scene, 0, scene, loop / 2), "the animation moves").toBeGreaterThan(1);
  expect(await diff(page, scene, loop, scene, 0)).toBeLessThan(0.01);
});

test("every kind with motion loops without a jump", async ({ page }) => {
  test.setTimeout(180_000);
  await page.goto("/");
  const kinds = await page.evaluate(async () => {
    const load = async <T>(path: string): Promise<T> =>
      (await import(/* @vite-ignore */ path)) as T;
    const { KINDS } = await load<typeof Kinds>("/src/shader/kinds.ts");
    return KINDS.filter((k) => !k.still && k.id !== "grain").map((k) => ({
      id: k.id,
      role: k.role,
    }));
  });
  const loop = 8;
  const step = loop / 240;
  for (const kind of kinds) {
    const scene = await page.evaluate(async (k) => {
      const load = async <T>(path: string): Promise<T> =>
        (await import(/* @vite-ignore */ path)) as T;
      const { kindById } = await load<typeof Kinds>("/src/shader/kinds.ts");
      const { newLayer, newScene } = await load<typeof Scene>("/src/shader/scene.ts");
      const def = kindById(k.id);
      const base = kindById("liquid");
      if (!def || !base) throw new Error("kind");
      // Something to look at below an effect, and a speed that makes the layer move.
      const below = { ...newLayer(base, "base"), speed: 1 };
      const layer = { ...newLayer(def, "l"), speed: def.speed === 0 ? 1 : def.speed };
      return newScene({ layers: k.role === "effect" ? [below, layer] : [layer] });
    }, kind);
    const seam = await diff(page, scene, loop - step, scene, 0);
    const normal = await diff(page, scene, 2.6, scene, 2.6 + step);
    expect(seam, `${kind.id} closes its loop`).toBeLessThan(normal * 1.6 + 0.6);
    expect(await diff(page, scene, loop, scene, 0), kind.id).toBeLessThan(0.01);
  }
});

test("the same scene at the same moment gives the same picture at any size", async ({ page }) => {
  await page.goto("/");
  const scene = await page.evaluate(async () => {
    const load = async <T>(path: string): Promise<T> =>
      (await import(/* @vite-ignore */ path)) as T;
    const { ANIMATED_LOOKS } = await load<typeof Scenes>("/src/shader/scenes.ts");
    return ANIMATED_LOOKS[2]?.make();
  });
  const small = await frame(page, scene, 2, 160, 90);
  const big = await frame(page, scene, 2, 640, 360);
  for (let c = 0; c < 3; c += 1) {
    expect(Math.abs((small.mean[c] ?? 0) - (big.mean[c] ?? 0))).toBeLessThan(6);
  }
});

test("code you write draws, and a mistake names the line", async ({ page }) => {
  await page.goto("/");
  const results = await page.evaluate(async () => {
    const load = async <T>(path: string): Promise<T> =>
      (await import(/* @vite-ignore */ path)) as T;
    const { ShaderRenderer } = await load<typeof Renderer>("/src/shader/renderer.ts");
    const { EXAMPLES } = await load<typeof Custom>("/src/shader/custom.ts");
    const renderer = new ShaderRenderer();
    const out: Record<string, unknown> = {};
    for (const example of EXAMPLES) out[example.id] = renderer.tryCompile(example.code);
    const first = EXAMPLES[0]?.code ?? "";
    out["typo"] = renderer.tryCompile(first.replace("sin(p.x", "sinn(p.x"));
    out["loop"] = renderer.tryCompile(
      first.replace(
        "void main() {",
        "#extension GL_OES_standard_derivatives : enable\nvoid main() {",
      ),
    );
    renderer.dispose();
    return out;
  });
  for (const id of Object.keys(results)) {
    if (id === "typo" || id === "loop") continue;
    expect(results[id], id).toMatchObject({ ok: true });
  }
  const typo = results["typo"] as { ok: boolean; line: number | null; message: string };
  expect(typo.ok).toBe(false);
  expect(typo.line).toBe(16);
  expect(typo.message).toContain("sinn");
  expect(results["loop"]).toMatchObject({ ok: false });
});
