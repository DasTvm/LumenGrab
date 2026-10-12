import { useStore } from "zustand";
import { platform } from "@/platform";
import { createLooksStore, type LooksBackend, type LooksStore } from "@/presentation/looks-store";

/** The looks store of this window, backed by the platform (native files in the app, localStorage in the browser mock). */
const backend: LooksBackend = {
  load: () => platform.looksLoad(),
  save: (json) => platform.looksSave(json),
  readAsset: (name) => platform.looksReadAsset(name),
  writeAsset: (name, bytes) => platform.looksWriteAsset(name, bytes),
  pruneAssets: (keep) => platform.looksPruneAssets(keep),
  onChanged: (listener) => platform.onLooksChanged(listener),
};

export const looksStore = createLooksStore(backend);

export function useLooks<T>(selector: (state: LooksStore) => T): T {
  return useStore(looksStore, selector);
}
