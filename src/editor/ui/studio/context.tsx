import { createContext, useContext, type ReactNode } from "react";
import { useStore } from "zustand";
import type { StudioStore, StudioStoreApi } from "./studio-store";

const StudioContext = createContext<StudioStoreApi | null>(null);

export function StudioProvider({
  store,
  children,
}: {
  store: StudioStoreApi;
  children: ReactNode;
}) {
  return <StudioContext.Provider value={store}>{children}</StudioContext.Provider>;
}

export function useStudioStore(): StudioStoreApi {
  const store = useContext(StudioContext);
  if (!store) throw new Error("StudioProvider is missing");
  return store;
}

/** Subscribes to a slice of the Studio state. */
export function useStudio<T>(selector: (state: StudioStore) => T): T {
  return useStore(useStudioStore(), selector);
}
