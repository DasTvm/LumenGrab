import { SHADER_LIMITS } from "@/document/limits";
import { randomPalette } from "@/presentation/backgrounds";
import { seededRandom } from "@/document/render/pixels";
import { kindById, kindDefaults } from "./kinds";
import { defaultParams, resolveParams } from "./params";
import { newCustomLayer, newLayer } from "./scene";
import type { LayerPatch, LayerRole, ShaderLayer, ShaderParamValue, ShaderScene } from "./types";

/**
 * What the Studio does to a scene. Every function returns a new scene and leaves the old one alone, so the
 * Studio's undo is a list of scenes. Layers are stored bottom first; the Stack shows them top first.
 */

const newId = () => crypto.randomUUID().slice(0, 12);

export const canAddLayer = (scene: ShaderScene): boolean =>
  scene.layers.length < SHADER_LIMITS.maxLayers;

const replace = (scene: ShaderScene, layers: ShaderLayer[]): ShaderScene => ({ ...scene, layers });

/** A new layer on top of the stack. `null` when the stack is full. */
export function addLayer(
  scene: ShaderScene,
  kindId: string,
  id: string = newId(),
): { scene: ShaderScene; id: string } | null {
  const kind = kindById(kindId);
  if (!kind || !canAddLayer(scene)) return null;
  return { scene: replace(scene, [...scene.layers, newLayer(kind, id)]), id };
}

/** A layer with your own code on top of the stack. */
export function addCustom(
  scene: ShaderScene,
  role: LayerRole,
  title: string,
  code: string,
  values: ShaderLayer["params"] = {},
  id: string = newId(),
): { scene: ShaderScene; id: string } | null {
  if (!canAddLayer(scene)) return null;
  return {
    scene: replace(scene, [...scene.layers, newCustomLayer(role, title, code, values, id)]),
    id,
  };
}

export function removeLayer(scene: ShaderScene, id: string): ShaderScene {
  return replace(
    scene,
    scene.layers.filter((l) => l.id !== id),
  );
}

/** A copy right above the original. */
export function duplicateLayer(
  scene: ShaderScene,
  id: string,
  copyId: string = newId(),
): { scene: ShaderScene; id: string } | null {
  const at = scene.layers.findIndex((l) => l.id === id);
  const original = scene.layers[at];
  if (!original || !canAddLayer(scene)) return null;
  const copy: ShaderLayer = structuredClone({ ...original, id: copyId });
  const layers = [...scene.layers];
  layers.splice(at + 1, 0, copy);
  return { scene: replace(scene, layers), id: copyId };
}

/** Moves a layer to a place in the (bottom first) list. */
export function moveLayer(scene: ShaderScene, id: string, to: number): ShaderScene {
  const from = scene.layers.findIndex((l) => l.id === id);
  if (from < 0) return scene;
  const layers = [...scene.layers];
  const [moved] = layers.splice(from, 1);
  if (!moved) return scene;
  layers.splice(Math.min(Math.max(0, to), layers.length), 0, moved);
  return replace(scene, layers);
}

export function patchLayer(scene: ShaderScene, id: string, patch: LayerPatch): ShaderScene {
  return replace(
    scene,
    scene.layers.map((l) => (l.id === id ? { ...l, ...patch } : l)),
  );
}

export function setParam(
  scene: ShaderScene,
  id: string,
  key: string,
  value: ShaderParamValue,
): ShaderScene {
  return replace(
    scene,
    scene.layers.map((l) => (l.id === id ? { ...l, params: { ...l.params, [key]: value } } : l)),
  );
}

/** The settings of one section (or all of them) back to their defaults. */
export function resetParams(scene: ShaderScene, id: string, group?: string): ShaderScene {
  const layer = scene.layers.find((l) => l.id === id);
  const kind = layer ? kindById(layer.kind) : undefined;
  if (!layer || !kind) return scene;
  const defaults = kindDefaults(kind);
  const params = { ...layer.params };
  for (const spec of kind.specs) {
    if (group === undefined || spec.group === group) {
      const value = defaults[spec.id];
      if (value !== undefined) params[spec.id] = value;
    }
  }
  return replace(
    scene,
    scene.layers.map((l) => (l.id === id ? { ...l, params } : l)),
  );
}

/** Whether a setting still has the value a new layer starts with. */
export function isDefault(layer: ShaderLayer, key: string): boolean {
  const kind = kindById(layer.kind);
  const spec = kind?.specs.find((s) => s.id === key);
  if (!kind || !spec) return true;
  const have = resolveParams([spec], layer.params)[key];
  const want = defaultParams([spec])[key];
  return JSON.stringify(have) === JSON.stringify(want);
}

export function setPalette(scene: ShaderScene, palette: string[]): ShaderScene {
  return {
    ...scene,
    palette: palette.slice(0, SHADER_LIMITS.maxPalette).length
      ? palette.slice(0, SHADER_LIMITS.maxPalette)
      : scene.palette,
  };
}

/** Six colours that go together, from the hand-picked sets of the gradient shuffle. */
export function randomColours(seed: number): string[] {
  const first = randomPalette(seed);
  const second = randomPalette(seed + 1);
  return [...first, ...second.slice(0, 3)].slice(0, 6);
}

/** A new seed and a new palette; layers keep their settings (and their own seeds). */
export function randomize(scene: ShaderScene, seed: number): ShaderScene {
  const random = seededRandom(seed);
  const colours = randomColours(seed);
  // The order of the colours decides which ones the layers use first: shuffle them a little.
  for (let i = colours.length - 1; i > 0; i -= 1) {
    const j = Math.floor(random() * (i + 1));
    [colours[i], colours[j]] = [colours[j] ?? "#808080", colours[i] ?? "#808080"];
  }
  return { ...scene, seed, palette: colours };
}

/** A problem that stops a scene from being used, in words, or `null`. */
export function sceneProblem(scene: ShaderScene): string | null {
  if (scene.layers.length > SHADER_LIMITS.maxLayers) return "too many layers";
  const code = scene.layers.reduce((sum, l) => sum + (l.code?.length ?? 0), 0);
  if (code > SHADER_LIMITS.maxTotalCodeLength) return "too much code";
  return null;
}
