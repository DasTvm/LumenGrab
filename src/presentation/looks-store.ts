import { z } from "zod";
import { createStore, type StoreApi } from "zustand/vanilla";
import { PresentationSchema } from "@/document/schema";
import { BUILTIN_LOOKS, type Look, type LookParts } from "./looks";

/**
 * The user's looks (docs/adr/0007): a list of saved looks and the default look, kept in `looks.json` in the
 * app's config folder, with background pictures as files next to it (`looks/assets/<sha256>.<ext>`). The
 * native side only stores text and bytes; everything is validated here, and one broken look never costs
 * the others.
 */
export const LOOK_NAME_MAX = 40;
export const MAX_LOOKS = 200;

const PartsSchema = PresentationSchema.pick({
  background: true,
  padding: true,
  cornerRadius: true,
  shadow: true,
  frame: true,
  aspect: true,
}).partial();

const LookSchema = z.object({
  id: z.string().min(1).max(64),
  name: z.string().trim().min(1).max(LOOK_NAME_MAX),
  parts: PartsSchema,
});

export interface LooksFile {
  version: 1;
  looks: Look[];
  defaultLook: Look | null;
}

export const EMPTY_LOOKS: LooksFile = { version: 1, looks: [], defaultLook: null };

/** Reads `looks.json`; anything that is not valid is dropped, a file that is not JSON gives an empty list. */
export function parseLooks(text: string | null): LooksFile {
  if (!text) return { ...EMPTY_LOOKS, looks: [] };
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch {
    return { ...EMPTY_LOOKS, looks: [] };
  }
  if (typeof raw !== "object" || raw === null) return { ...EMPTY_LOOKS, looks: [] };
  const record = raw as Record<string, unknown>;
  const looks: Look[] = [];
  const seen = new Set<string>();
  if (Array.isArray(record["looks"])) {
    for (const entry of record["looks"].slice(0, MAX_LOOKS)) {
      const parsed = LookSchema.safeParse(entry);
      if (parsed.success && !seen.has(parsed.data.id)) {
        seen.add(parsed.data.id);
        looks.push(parsed.data);
      }
    }
  }
  const def = LookSchema.safeParse(record["defaultLook"]);
  return { version: 1, looks, defaultLook: def.success ? def.data : null };
}

export function serializeLooks(file: LooksFile): string {
  return `${JSON.stringify(file, null, 2)}\n`;
}

/** The asset names the looks (and the default look) still use. */
export function assetsOfLooks(file: LooksFile): string[] {
  const names = new Set<string>();
  for (const look of [...file.looks, ...(file.defaultLook ? [file.defaultLook] : [])]) {
    const bg = look.parts.background;
    if (bg?.type === "image" && bg.asset) names.add(bg.asset);
  }
  return [...names];
}

/** Where the looks live: the native side in the app, localStorage in the browser mock, memory in tests. */
export interface LooksBackend {
  load(): Promise<string | null>;
  save(json: string): Promise<void>;
  readAsset(name: string): Promise<Uint8Array | null>;
  writeAsset(name: string, bytes: Uint8Array): Promise<void>;
  pruneAssets(keep: string[]): Promise<void>;
  /** Calls `listener` when another window changed the looks; returns the stop function. */
  onChanged(listener: () => void): Promise<() => void>;
}

export interface LooksState {
  loaded: boolean;
  looks: Look[];
  defaultLook: Look | null;
  /** The last problem (the file could not be saved), for a notice. */
  error: string | null;
}

/** A look that was just removed, with what Undo needs to bring it back. */
export interface Removed {
  look: Look;
  index: number;
  assets: Record<string, Uint8Array>;
}

export type SaveResult = { status: "saved"; look: Look } | { status: "exists"; existing: Look };

export interface LooksActions {
  init(): Promise<void>;
  /** Saves a new look. A name that is taken (ignoring case) is not saved unless `replace` is true. */
  saveLook(name: string, parts: LookParts, options?: { replace?: boolean }): Promise<SaveResult>;
  updateLook(id: string, parts: LookParts): Promise<void>;
  renameLook(id: string, name: string): Promise<void>;
  /** Removes a look and returns it with its place and its picture, so the toast can put it back. */
  removeLook(id: string): Promise<Removed | null>;
  restoreLook(removed: Removed): Promise<void>;
  /** Sets the look new screenshots get, `null` for none. The look is copied, so deleting it later does not change the default. */
  setDefault(look: Look | null): Promise<void>;
  /** Stores a background picture of a look. */
  addAsset(name: string, bytes: Uint8Array): Promise<void>;
  readAsset(name: string): Promise<Uint8Array | null>;
}

export type LooksStore = LooksState & LooksActions;
export type LooksStoreApi = StoreApi<LooksStore>;

const sameName = (a: string, b: string) => a.trim().toLowerCase() === b.trim().toLowerCase();

/** Whether `name` is the name of a built-in look (those cannot be replaced). */
export const isBuiltinName = (name: string) => BUILTIN_LOOKS.some((l) => sameName(l.name, name));

export function createLooksStore(
  backend: LooksBackend,
  makeId: () => string = () => crypto.randomUUID().slice(0, 12),
): LooksStoreApi {
  return createStore<LooksStore>()((set, get) => {
    let started = false;
    const persist = async (next: Pick<LooksState, "looks" | "defaultLook">) => {
      set(next);
      try {
        await backend.save(serializeLooks({ version: 1, ...next }));
        await backend.pruneAssets(assetsOfLooks({ version: 1, ...next }));
        set({ error: null });
      } catch (e) {
        set({ error: e instanceof Error ? e.message : "Your looks could not be saved." });
      }
    };
    const reload = async () => {
      const file = parseLooks(await backend.load().catch(() => null));
      set({ loaded: true, looks: file.looks, defaultLook: file.defaultLook });
    };
    return {
      loaded: false,
      looks: [],
      defaultLook: null,
      error: null,

      init: async () => {
        if (started) return;
        started = true;
        await reload();
        await backend.onChanged(() => void reload()).catch(() => undefined);
      },

      saveLook: async (name, parts, options) => {
        const trimmed = name.trim().slice(0, LOOK_NAME_MAX);
        const existing = get().looks.find((l) => sameName(l.name, trimmed));
        if (existing && !options?.replace) return { status: "exists", existing };
        const look: Look = { id: existing?.id ?? makeId(), name: trimmed, parts };
        const looks = existing
          ? get().looks.map((l) => (l.id === existing.id ? look : l))
          : [...get().looks, look];
        await persist({ looks, defaultLook: get().defaultLook });
        return { status: "saved", look };
      },

      updateLook: async (id, parts) => {
        const looks = get().looks.map((l) => (l.id === id ? { ...l, parts } : l));
        await persist({ looks, defaultLook: get().defaultLook });
      },

      renameLook: async (id, name) => {
        const trimmed = name.trim().slice(0, LOOK_NAME_MAX);
        if (!trimmed) return;
        const looks = get().looks.map((l) => (l.id === id ? { ...l, name: trimmed } : l));
        await persist({ looks, defaultLook: get().defaultLook });
      },

      removeLook: async (id) => {
        const index = get().looks.findIndex((l) => l.id === id);
        const look = get().looks[index];
        if (!look) return null;
        const assets: Record<string, Uint8Array> = {};
        for (const name of assetsOfLooks({ version: 1, looks: [look], defaultLook: null })) {
          const bytes = await backend.readAsset(name).catch(() => null);
          if (bytes) assets[name] = bytes;
        }
        await persist({
          looks: get().looks.filter((l) => l.id !== id),
          defaultLook: get().defaultLook,
        });
        return { look, index, assets };
      },

      restoreLook: async ({ look, index, assets }) => {
        if (get().looks.some((l) => l.id === look.id)) return;
        for (const [name, bytes] of Object.entries(assets)) await backend.writeAsset(name, bytes);
        const looks = [...get().looks];
        looks.splice(Math.min(index, looks.length), 0, look);
        await persist({ looks, defaultLook: get().defaultLook });
      },

      setDefault: async (look) => {
        await persist({ looks: get().looks, defaultLook: look ? structuredClone(look) : null });
      },

      addAsset: (name, bytes) => backend.writeAsset(name, bytes),
      readAsset: (name) => backend.readAsset(name),
    };
  });
}
