import { createContext, useContext, type ReactNode } from "react";
import { useStore } from "zustand";
import type { EditorStore, EditorStoreApi } from "../model/store";
import type { DocumentSession } from "./session";
import type { UiStore, UiStoreApi } from "./ui-store";

interface EditorContextValue {
  editor: EditorStoreApi;
  ui: UiStoreApi;
  /** Saving, exporting and the pictures inside the document. */
  session: DocumentSession;
}

const EditorContext = createContext<EditorContextValue | null>(null);

export function EditorProvider({
  editor,
  ui,
  session,
  children,
}: EditorContextValue & { children: ReactNode }) {
  return (
    <EditorContext.Provider value={{ editor, ui, session }}>{children}</EditorContext.Provider>
  );
}

function useCtx(): EditorContextValue {
  const value = useContext(EditorContext);
  if (!value) throw new Error("EditorProvider is missing");
  return value;
}

/** Subscribes to a slice of the document state (project, selection, undo flags). */
export function useEditor<T>(selector: (state: EditorStore) => T): T {
  return useStore(useCtx().editor, selector);
}

/** Subscribes to a slice of the UI state (tool, options, view, panel). */
export function useUi<T>(selector: (state: UiStore) => T): T {
  return useStore(useCtx().ui, selector);
}

/** The stores themselves, for event handlers (`getState()` without subscribing). */
export function useStores(): EditorContextValue {
  return useCtx();
}
