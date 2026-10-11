import { useEffect, useMemo } from "react";
import { TriangleAlert } from "lucide-react";
import type { RgbaImage } from "@/document/render/pixels";
import type { DocumentFile, DocumentWarning } from "@/document/types";
import { BaseImage } from "./base-image";
import { runCommand, isTyping } from "./commands";
import { EditorProvider } from "./context";
import { EditorCanvas } from "./EditorCanvas";
import { RightPanel } from "./RightPanel";
import { commandForKey } from "./shortcuts";
import { ToolRail } from "./ToolRail";
import { TopBar } from "./TopBar";
import { createUiStore, type UiStoreApi } from "./ui-store";
import { createEditorStore, type EditorStoreApi } from "../model/store";
import { findLayer } from "../model/tree";
import { applyCrop, cancelCrop } from "./crop-mode";
import { startEditText } from "./text-edit";

interface Props {
  doc: DocumentFile;
  /** The decoded source picture (never modified). */
  source: RgbaImage;
  fileName: string;
  warnings: DocumentWarning[];
  busy: boolean;
  notice: { ok: boolean; text: string } | null;
  /** Called with the current document (project as edited) when Export is pressed. */
  onExport: (doc: DocumentFile) => void;
}

declare global {
  interface Window {
    /** Dev and test builds only: the stores of the open editor, for the browser tests. */
    __lumengrabEditor?: { editor: EditorStoreApi; ui: UiStoreApi };
  }
}

const isMac = typeof navigator !== "undefined" && /mac/i.test(navigator.platform);

/**
 * The editor window of an editable document (`?window=document`): top bar, tool rail, canvas, and the
 * panel with the Style and Layers tabs. The stores are made once per document; nothing here touches
 * the file system, the window shell does.
 */
export function EditorWindow({ doc, source, fileName, warnings, busy, notice, onExport }: Props) {
  const project = doc.project;
  if (!project) throw new Error("The editor needs an editable document.");
  const editor = useMemo(() => createEditorStore(project), [project]);
  const ui = useMemo(() => createUiStore({ width: source.width, height: source.height }), [source]);
  const base = useMemo(() => new BaseImage(source), [source]);

  useEffect(() => {
    if (import.meta.env.DEV) window.__lumengrabEditor = { editor, ui };
  }, [editor, ui]);

  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (isTyping(e.target)) return;
      if (e.code === "Space" && !e.repeat) {
        e.preventDefault();
        ui.getState().setPanning(true);
        return;
      }
      if (ui.getState().crop) {
        // The crop tool: Enter applies, Esc cancels, the other tools are off.
        if (e.key === "Enter") {
          e.preventDefault();
          applyCrop(editor, ui);
        } else if (e.key === "Escape") {
          e.preventDefault();
          cancelCrop(editor, ui);
        }
        return;
      }
      if (e.key === "Enter" && !e.metaKey && !e.ctrlKey && !e.altKey) {
        // Enter edits the selected text (and the layers panel renames its own rows).
        const { project, selection } = editor.getState();
        const only = selection.length === 1 ? findLayer(project.layers, selection[0] ?? "") : null;
        if (only?.type === "text" && startEditText(editor, ui, only.id)) e.preventDefault();
        return;
      }
      const command = commandForKey(e, isMac);
      if (!command) return;
      e.preventDefault();
      runCommand(command, {
        editor,
        ui,
        outside: {
          export: () => {
            onExport({ ...doc, project: editor.getState().project });
          },
        },
      });
    };
    const onKeyUp = (e: KeyboardEvent) => {
      if (e.code === "Space") ui.getState().setPanning(false);
    };
    window.addEventListener("keydown", onKeyDown);
    window.addEventListener("keyup", onKeyUp);
    return () => {
      window.removeEventListener("keydown", onKeyDown);
      window.removeEventListener("keyup", onKeyUp);
    };
  }, [editor, ui, doc, onExport]);

  return (
    <EditorProvider editor={editor} ui={ui}>
      <div className="flex h-screen flex-col bg-background text-foreground">
        <TopBar
          fileName={fileName}
          busy={busy}
          readOnly={false}
          onExport={() => {
            onExport({ ...doc, project: editor.getState().project });
          }}
        />
        {warnings.length > 0 ? (
          <ul aria-label="Notices" className="flex flex-col gap-2 border-b border-border px-6 py-2">
            {warnings.map((w) => (
              <li
                key={w.code}
                role="status"
                className="flex items-center gap-2 rounded-md border border-warning-border bg-warning-soft px-3 py-1.5 text-[13px]"
              >
                <TriangleAlert aria-hidden className="size-4 shrink-0 text-warning" />
                {w.message}
              </li>
            ))}
          </ul>
        ) : null}
        <div className="flex min-h-0 flex-1">
          <ToolRail readOnly={false} />
          <EditorCanvas base={base} />
          <RightPanel readOnly={false} />
        </div>
        <p
          role="status"
          aria-live="polite"
          className={notice?.ok === false ? "px-4 py-1 text-sm text-destructive" : "sr-only"}
        >
          {notice?.text ?? ""}
        </p>
      </div>
    </EditorProvider>
  );
}
