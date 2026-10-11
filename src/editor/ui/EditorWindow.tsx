import { useEffect, useMemo, useState } from "react";
import { TriangleAlert } from "lucide-react";
import type { RgbaImage } from "@/document/render/pixels";
import type { DocumentFile, DocumentWarning } from "@/document/types";
import type { DocumentInfo } from "@/platform";
import { BaseImage } from "./base-image";
import { runCommand, isTyping } from "./commands";
import { EditorProvider } from "./context";
import { EditorCanvas } from "./EditorCanvas";
import { RightPanel } from "./RightPanel";
import { commandForKey } from "./shortcuts";
import { ToolRail } from "./ToolRail";
import { TopBar } from "./TopBar";
import { createUiStore, type UiStoreApi } from "./ui-store";
import { ExportDialog } from "./dialogs/ExportDialog";
import { FailureDialog } from "./dialogs/FailureDialog";
import { UnsavedDialog } from "./dialogs/UnsavedDialog";
import { applyCrop, cancelCrop } from "./crop-mode";
import { DocumentSession, type Dialog, type Meta } from "./session";
import { startEditText } from "./text-edit";
import { createEditorStore, type EditorStoreApi } from "../model/store";
import { findLayer } from "../model/tree";

declare global {
  interface Window {
    /** Dev and test builds only: the stores of the open editor, for the browser tests. */
    __lumengrabEditor?: { editor: EditorStoreApi; ui: UiStoreApi; session: DocumentSession };
  }
}

interface Props {
  /** The window label (`doc-1`): how the native side knows this document. */
  label: string;
  doc: DocumentFile;
  /** The decoded source picture (never modified). */
  source: RgbaImage;
  info: DocumentInfo;
  app: { name: string; version: string };
  warnings: DocumentWarning[];
}

const isMac = typeof navigator !== "undefined" && /mac/i.test(navigator.platform);

/**
 * The editor window of an editable document (`?window=document`): top bar, tool rail, canvas, and the
 * panel with the Style and Layers tabs, plus the dialogs (Export, unsaved changes, errors). The stores are
 * made once per document; saving, exporting and recovery are the `DocumentSession`.
 */
export function EditorWindow({ label, doc, source, info, app, warnings }: Props) {
  const project = doc.project;
  if (!project) throw new Error("The editor needs an editable document.");
  const editor = useMemo(() => createEditorStore(project), [project]);
  const ui = useMemo(() => createUiStore({ width: source.width, height: source.height }), [source]);
  const base = useMemo(() => new BaseImage(source), [source]);
  const [dialog, setDialog] = useState<Dialog>(null);
  const [meta, setMeta] = useState<Meta>({ fileName: info.fileName, kind: info.kind });
  const session = useMemo(
    () =>
      new DocumentSession({
        label,
        doc,
        source,
        info,
        app,
        editor,
        ui,
        onMeta: setMeta,
        onDialog: setDialog,
      }),
    [label, doc, source, info, app, editor, ui],
  );
  const [webp, setWebp] = useState(true);

  useEffect(() => {
    void session.webpAvailable().then(setWebp);
  }, [session]);

  useEffect(() => {
    if (import.meta.env.DEV) window.__lumengrabEditor = { editor, ui, session };
  }, [editor, ui, session]);

  useEffect(() => session.start(), [session]);

  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (isTyping(e.target)) return;
      if (document.querySelector('[role="dialog"][aria-modal="true"]')) return; // a dialog owns the keys
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
        const { project: current, selection } = editor.getState();
        const only = selection.length === 1 ? findLayer(current.layers, selection[0] ?? "") : null;
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
          save: () => {
            void session.save();
          },
          saveAs: () => {
            void session.saveAsDocument();
          },
          export: () => {
            session.openExport();
          },
          copy: () => {
            void session.copy();
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
  }, [editor, ui, session]);

  return (
    <EditorProvider editor={editor} ui={ui}>
      <div className="flex h-screen flex-col bg-background text-foreground">
        <TopBar
          fileName={meta.fileName}
          readOnly={false}
          onExport={() => {
            session.openExport();
          }}
          onCopy={() => {
            void session.copy();
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
        {dialog?.type === "export" ? (
          <ExportDialog
            documentName={meta.fileName}
            content={session.content}
            redactions={session.redactions}
            initialFormat={dialog.format}
            webpAvailable={webp}
            estimate={session.estimate}
            onSave={(choice) => {
              void session.export(choice);
            }}
            onCopy={(size) => {
              void session.copy(size);
            }}
            onClose={() => {
              setDialog(null);
            }}
          />
        ) : null}
        {dialog?.type === "unsaved" ? (
          <UnsavedDialog
            name={meta.fileName.replace(/\.lumengrab$/i, "")}
            onSave={() => {
              void session.saveAndClose();
            }}
            onDiscard={() => {
              void session.discardAndClose();
            }}
            onCancel={() => {
              setDialog(null);
            }}
          />
        ) : null}
        {dialog?.type === "failure" ? (
          <FailureDialog
            failure={dialog.failure}
            onClose={() => {
              setDialog(null);
            }}
          />
        ) : null}
      </div>
    </EditorProvider>
  );
}
