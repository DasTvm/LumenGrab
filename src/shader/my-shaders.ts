import { z } from "zod";
import { createStore, type StoreApi } from "zustand/vanilla";
import { SHADER_LIMITS } from "@/document/limits";
import { checkCustomCode } from "./custom";

/**
 * "My shaders" (docs/adr/0009): shaders you wrote once and add to any look, and the documents whose
 * custom code may run. Two small files in the app's config folder; the native side only stores text,
 * this validates it, so a damaged file loses the broken entries and nothing else.
 */
export const SHADER_NAME_MAX = 40;
const MAX_SHADERS = 200;
const MAX_TRUSTED = 1000;

const MyShaderSchema = z.object({
  id: z.string().min(1).max(64),
  name: z.string().trim().min(1).max(SHADER_NAME_MAX),
  role: z.enum(["generator", "effect"]),
  code: z.string().max(SHADER_LIMITS.maxCodeLength),
  /** The values of its settings when it is added (the "defaults" the user kept). */
  values: z.record(z.string().max(64), z.union([z.number(), z.boolean(), z.string().max(64)])),
});
export type MyShader = z.infer<typeof MyShaderSchema>;

export interface ShadersFile {
  version: 1;
  shaders: MyShader[];
}

/** Reads `my-shaders.json`; an entry that is not valid is dropped, a file that is not JSON gives an empty list. */
export function parseShaders(text: string | null): ShadersFile {
  const empty: ShadersFile = { version: 1, shaders: [] };
  if (!text) return empty;
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch {
    return empty;
  }
  const list = (raw as { shaders?: unknown } | null)?.shaders;
  if (!Array.isArray(list)) return empty;
  const seen = new Set<string>();
  const shaders: MyShader[] = [];
  for (const entry of list.slice(0, MAX_SHADERS)) {
    const parsed = MyShaderSchema.safeParse(entry);
    if (!parsed.success || seen.has(parsed.data.id) || !checkCustomCode(parsed.data.code).ok)
      continue;
    seen.add(parsed.data.id);
    shaders.push(parsed.data);
  }
  return { version: 1, shaders };
}

/** Reads `trusted.json`: the ids of documents whose code may run. */
export function parseTrusted(text: string | null): string[] {
  if (!text) return [];
  try {
    const list = (JSON.parse(text) as { documents?: unknown } | null)?.documents;
    if (!Array.isArray(list)) return [];
    return [
      ...new Set(
        list.filter((x): x is string => typeof x === "string" && x.length > 0 && x.length <= 64),
      ),
    ].slice(-MAX_TRUSTED);
  } catch {
    return [];
  }
}

const json = (value: unknown) => `${JSON.stringify(value, null, 2)}\n`;

export interface ShadersBackend {
  load(name: "my-shaders" | "trusted"): Promise<string | null>;
  save(name: "my-shaders" | "trusted", json: string): Promise<void>;
  onChanged(listener: () => void): Promise<() => void>;
}

export interface ShadersState {
  loaded: boolean;
  shaders: MyShader[];
  trusted: string[];
  error: string | null;
}

const sameName = (a: string, b: string) => a.trim().toLowerCase() === b.trim().toLowerCase();

/** `base`, or `base 2`, `base 3`... when the name is taken by another shader (ignoring case). */
export function uniqueShaderName(
  shaders: readonly MyShader[],
  base: string,
  exceptId?: string,
): string {
  const clean = base.trim().slice(0, SHADER_NAME_MAX) || "Untitled shader";
  const taken = (name: string) => shaders.some((s) => s.id !== exceptId && sameName(s.name, name));
  if (!taken(clean)) return clean;
  for (let n = 2; ; n += 1) {
    const suffix = ` ${String(n)}`;
    const candidate = `${clean.slice(0, SHADER_NAME_MAX - suffix.length)}${suffix}`;
    if (!taken(candidate)) return candidate;
  }
}

export type SaveShaderResult =
  { status: "saved"; shader: MyShader } | { status: "exists"; existing: MyShader };

export interface ShadersActions {
  init(): Promise<void>;
  /** Keeps a shader. A name that is taken (ignoring case) is not saved unless `replace` is true. */
  saveShader(
    shader: Omit<MyShader, "id">,
    options?: { replace?: boolean },
  ): Promise<SaveShaderResult>;
  /**
   * Keeps what the editor writes, as it is written: a new shader (named so that no other has the name) or
   * the change of one it made before (`id`). Returns the shader as stored.
   */
  keepShader(shader: Omit<MyShader, "id">, id?: string): Promise<MyShader>;
  /** A copy under a free name ("Glow copy"). */
  duplicateShader(id: string): Promise<MyShader | null>;
  removeShader(id: string): Promise<MyShader | null>;
  /** The code of this document may run from now on. */
  trustDocument(documentId: string): Promise<void>;
}

export type ShadersStore = ShadersState & ShadersActions;
export type ShadersStoreApi = StoreApi<ShadersStore>;

export function createShadersStore(
  backend: ShadersBackend,
  makeId: () => string = () => crypto.randomUUID().slice(0, 12),
): ShadersStoreApi {
  return createStore<ShadersStore>()((set, get) => {
    let starting: Promise<void> | null = null;
    const reload = async () => {
      const [mine, trusted] = await Promise.all([
        backend.load("my-shaders").catch(() => null),
        backend.load("trusted").catch(() => null),
      ]);
      set({ loaded: true, shaders: parseShaders(mine).shaders, trusted: parseTrusted(trusted) });
    };
    const persistShaders = async (shaders: MyShader[]) => {
      set({ shaders });
      try {
        await backend.save("my-shaders", json({ version: 1, shaders }));
        set({ error: null });
      } catch (e) {
        set({ error: e instanceof Error ? e.message : "Your shaders could not be saved." });
      }
    };
    return {
      loaded: false,
      shaders: [],
      trusted: [],
      error: null,

      init: () => {
        starting ??= (async () => {
          await reload();
          await backend.onChanged(() => void reload()).catch(() => undefined);
        })();
        return starting;
      },

      saveShader: async (shader, options) => {
        const name = shader.name.trim().slice(0, SHADER_NAME_MAX);
        const existing = get().shaders.find((s) => sameName(s.name, name));
        if (existing && !options?.replace) return { status: "exists", existing };
        const saved: MyShader = { ...shader, name, id: existing?.id ?? makeId() };
        await persistShaders(
          existing
            ? get().shaders.map((s) => (s.id === existing.id ? saved : s))
            : [...get().shaders, saved],
        );
        return { status: "saved", shader: saved };
      },

      keepShader: async (shader, id) => {
        const current = id ? get().shaders.find((s) => s.id === id) : undefined;
        const name = uniqueShaderName(get().shaders, shader.name, current?.id);
        const saved: MyShader = { ...shader, name, id: current?.id ?? makeId() };
        await persistShaders(
          current
            ? get().shaders.map((s) => (s.id === current.id ? saved : s))
            : [...get().shaders, saved],
        );
        return saved;
      },

      duplicateShader: async (id) => {
        const found = get().shaders.find((s) => s.id === id);
        if (!found) return null;
        return get().keepShader({
          name: `${found.name} copy`,
          role: found.role,
          code: found.code,
          values: { ...found.values },
        });
      },

      removeShader: async (id) => {
        const found = get().shaders.find((s) => s.id === id);
        if (!found) return null;
        await persistShaders(get().shaders.filter((s) => s.id !== id));
        return found;
      },

      trustDocument: async (documentId) => {
        if (get().trusted.includes(documentId)) return;
        const trusted = [...get().trusted, documentId].slice(-MAX_TRUSTED);
        set({ trusted });
        try {
          await backend.save("trusted", json({ version: 1, documents: trusted }));
        } catch (e) {
          set({ error: e instanceof Error ? e.message : "This choice could not be saved." });
        }
      },
    };
  });
}
