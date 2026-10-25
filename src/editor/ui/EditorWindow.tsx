import { useEffect, useMemo, useState } from "react";
import { useStore } from "zustand";
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
import { LookNoticeBanner } from "./LookNoticeBanner";
import { StudioHost } from "./studio/Studio";
import { ToastStack } from "./ToastStack";
import { TopBar } from "./TopBar";
import { createUiStore, type UiStoreApi } from "./ui-store";
import { ExportDialog } from "./dialogs/ExportDialog";
import { AnimatedExportDialog } from "./studio/ExportDialog";
import { FailureDialog } from "./dialogs/FailureDialog";
import { UnsavedDialog } from "./dialogs/UnsavedDialog";
import { applyCrop, cancelCrop } from "./crop-mode";
import { DocumentSession, type Dialog, type Meta } from "./session";
import { startEditText } from "./text-edit";
import { createEditorStore, type EditorStoreApi } from "../model/store";
import { findLayer } from "../model/tree";
import { walkLayers } from "@/document/layers";
import { isSystemFontId, systemFontFamily } from "@/document/limits";
import { installedFonts } from "./FontPicker";
import { platform } from "@/platform";
import { applyDefaultLook, switchMode } from "./mode";
import { looksStore } from "./presentation/looks-instance";

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
  const mode = useStore(ui, (s) => s.mode);
  const studio = useStore(ui, (s) => s.studio);
  // The background moves now (the document's own `project` here is the one that was opened).
  const animated = useStore(
    editor,
    (s) => s.project.presentation.enabled && s.project.presentation.background.type === "shader",
  );
  const [webp, setWebp] = useState(true);
  // Text in a font installed on the device that made the file: say so if this device does not have it.
  const [missingFonts, setMissingFonts] = useState<string[]>([]);
  useEffect(() => {
    const used = new Set<string>();
    walkLayers(project.layers, (layer) => {
      const id = layer.type === "text" ? layer["fontId"] : null;
      if (typeof id === "string" && isSystemFontId(id)) used.add(systemFontFamily(id));
    });
    if (used.size === 0) return;
    void installedFonts().then((have) => {
      setMissingFonts([...used].filter((family) => !have.includes(family)));
    });
  }, [project]);

  useEffect(() => {
    void session.webpAvailable().then(setWebp);
  }, [session]);

  useEffect(() => {
    if (import.meta.env.DEV) window.__lumengrabEditor = { editor, ui, session };
  }, [editor, ui, session]);

  useEffect(() => session.start(), [session]);
  useEffect(() => session.openGate(), [session]);

  // The kept original of an automatic-look capture: the look goes on as a presentation (Annotate can still edit).
  useEffect(() => {
    if (!info.applyLook) return;
    void looksStore
      .getState()
      .init()
      .then(() => {
        applyDefaultLook(editor, ui, session);
      });
  }, [info.applyLook, editor, ui, session]);

  // A new capture starts in the Presentation tab when the user chose that in Settings.
  useEffect(() => {
    if (info.kind !== "capture") return;
    void platform.getSettingsInfo().then(
      (loaded) => {
        if (loaded.settings.presentation.openInPresentation)
          switchMode(editor, ui, "presentation", session);
      },
      () => undefined,
    );
  }, [info.kind, editor, ui, session]);

  // The user's looks are read early, so the first switch to Presentation already knows the default look.
  useEffect(() => {
    void looksStore.getState().init();
  }, []);

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
        session,
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
    <EditorProvider editor={editor} ui={ui} session={session}>
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
          onPin={() => {
            void session.pin();
          }}
        />
        {warnings.length + missingFonts.length > 0 ? (
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
            {missingFonts.map((family) => (
              <li
                key={family}
                role="status"
                className="flex items-center gap-2 rounded-md border border-warning-border bg-warning-soft px-3 py-1.5 text-[13px]"
              >
                <TriangleAlert aria-hidden className="size-4 shrink-0 text-warning" />
                {`The font “${family}” is not installed on this device. Inter is used instead.`}
              </li>
            ))}
          </ul>
        ) : null}
        <LookNoticeBanner />
        <div className="flex min-h-0 flex-1">
          {mode === "annotate" ? <ToolRail readOnly={false} /> : null}
          <EditorCanvas base={base} />
          <RightPanel readOnly={false} />
        </div>
        <ToastStack />
        {studio ? <StudioHost base={base} /> : null}
        {dialog?.type === "export" ? (
          <ExportDialog
            documentName={meta.fileName}
            content={session.content}
            redactions={session.redactions}
            initialFormat={dialog.format}
            webpAvailable={webp}
            {...(animated
              ? {
                  onVideo: () => {
                    setDialog({ type: "export-animated" });
                  },
                }
              : {})}
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
        {dialog?.type === "export-animated" ? (
          <AnimatedExportDialog
            base={base}
            name={meta.fileName.replace(/\.lumengrab$/i, "")}
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
              // An update restart that was waiting for this document is off.
              void platform.documentCloseCancelled();
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
