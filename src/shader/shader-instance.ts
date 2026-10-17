import { useStore } from "zustand";
import { platform } from "@/platform";
import { createShadersStore, type ShadersBackend, type ShadersStore } from "./my-shaders";

const backend: ShadersBackend = {
  load: (name) => platform.shadersLoad(name),
  save: (name, json) => platform.shadersSave(name, json),
  onChanged: (listener) => platform.onShadersChanged(listener),
};

/** The shaders store of this window (native files in the app, localStorage in the browser mock). */
export const shadersStore = createShadersStore(backend);

export function useShaders<T>(selector: (state: ShadersStore) => T): T {
  return useStore(shadersStore, selector);
}
