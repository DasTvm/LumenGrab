import { useCallback, useEffect, useMemo, useState } from "react";
import { Download, FolderSearch, Lock, TriangleAlert } from "lucide-react";
import { DocumentError } from "@/document/errors";
import { openDocument } from "@/document/read";
import { canvasCodec } from "@/document/render/canvas-codec";
import { hasAnnotations, renderFlat, renderPreview } from "@/document/render/flatten";
import type { OpenedDocument } from "@/document/types";
import { platform, type DocumentInfo, type Os } from "@/platform";
import { Badge } from "@/ui/components/badge";
import { Button } from "@/ui/components/button";
import { CantOpenDialog, ReadOnlyDialog } from "./document/DocumentDialog";

/** The Releases page: where "Check for updates" goes until the updater is enabled. */
const RELEASES_URL = "https://github.com/DasTvm/LumenGrab/releases";

type State =
  | { phase: "loading" }
  | { phase: "error"; message: string; detail: string }
  | { phase: "ready"; opened: OpenedDocument; info: DocumentInfo; preview: Uint8Array | null };

const fileManager = (os: Os) => (os === "windows" ? "Explorer" : "Finder");

function describeFailure(error: unknown): { message: string; detail: string } {
  if (error instanceof DocumentError) return { message: error.userMessage, detail: error.detail };
  return {
    message: "The file could not be read. Your original file was not changed.",
    detail: error instanceof Error ? error.message : "unknown error",
  };
}

const dateFormat = new Intl.DateTimeFormat(undefined, { dateStyle: "medium", timeStyle: "short" });
function formatDate(iso: string): string {
  const time = Date.parse(iso);
  return Number.isNaN(time) ? iso : dateFormat.format(time);
}

/**
 * The window of one open `.lumengrab` document (`?window=document&label=doc-1`). Until the editor
 * (M4) it is a viewer: the preview, what is in the file, notices, and the dialogs of the design for
 * a file that cannot be opened or was made by a newer version.
 */
export function DocumentWindow() {
  const label = new URLSearchParams(window.location.search).get("label") ?? "";
  const [state, setState] = useState<State>({ phase: "loading" });
  const [os, setOs] = useState<Os>("other");
  const [readOnlyAcknowledged, setReadOnlyAcknowledged] = useState(false);

  useEffect(() => {
    platform.getAppInfo().then(
      (app) => {
        setOs(app.os);
      },
      () => undefined,
    );
    const guard = { cancelled: false }; // set by the cleanup below, which the compiler cannot follow
    void (async () => {
      try {
        const [info, bytes] = await Promise.all([
          platform.getDocumentInfo(label),
          platform.loadDocument(label),
        ]);
        const opened = await openDocument(bytes);
        // The preview in the file, or a fresh one. A file without a project (newer version) never gets one:
        // its pixels could include what a newer redaction was meant to hide.
        const preview =
          opened.doc.preview ??
          (opened.doc.project ? await renderPreview(opened.doc, canvasCodec) : null);
        if (!guard.cancelled) setState({ phase: "ready", opened, info, preview });
      } catch (error) {
        if (!guard.cancelled) setState({ phase: "error", ...describeFailure(error) });
      }
    })();
    return () => {
      guard.cancelled = true;
    };
  }, [label]);

  const close = useCallback(() => {
    void platform.closeDocument(label);
  }, [label]);
  const reveal = useCallback(() => {
    void platform.revealDocument(label);
  }, [label]);

  const backdrop = "flex h-screen items-center justify-center bg-muted p-6";

  if (state.phase === "loading") {
    return (
      <main className={backdrop} aria-busy="true">
        <p className="text-sm text-muted-foreground">Opening…</p>
      </main>
    );
  }
  if (state.phase === "error") {
    return (
      <main className={backdrop}>
        <CantOpenDialog
          message={state.message}
          detail={state.detail}
          showLabel={`Show in ${fileManager(os)}`}
          onShow={reveal}
          onClose={close}
        />
      </main>
    );
  }
  const { opened } = state;
  if (opened.readOnly && !readOnlyAcknowledged) {
    return (
      <main className={backdrop}>
        <ReadOnlyDialog
          fileVersion={opened.readOnly.fileVersion}
          supportedVersion={opened.readOnly.supportedVersion}
          onKeepViewing={() => {
            setReadOnlyAcknowledged(true);
          }}
          onCheckForUpdates={() => {
            void platform.openUrl(RELEASES_URL);
          }}
        />
      </main>
    );
  }
  return <Viewer state={state} os={os} onReveal={reveal} />;
}

function Viewer({
  state,
  os,
  onReveal,
}: {
  state: Extract<State, { phase: "ready" }>;
  os: Os;
  onReveal: () => void;
}) {
  const { opened, info, preview } = state;
  const { doc, warnings, readOnly } = opened;
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<{ ok: boolean; text: string } | null>(null);

  const previewUrl = useMemo(
    () =>
      preview
        ? URL.createObjectURL(new Blob([new Uint8Array(preview)], { type: "image/png" }))
        : null,
    [preview],
  );
  useEffect(
    () => () => {
      if (previewUrl) URL.revokeObjectURL(previewUrl);
    },
    [previewUrl],
  );

  const layers = doc.project?.layers.length ?? 0;
  // Annotations are not drawn into an export before the editor (M4): exporting would silently leave them out.
  const exportBlocked =
    readOnly === null && doc.project !== null && hasAnnotations(doc.project)
      ? "This file has annotations. Exporting them comes with the editor."
      : null;
  const exportLabel = readOnly ? "Export preview as PNG" : "Export as PNG";
  const canExport = readOnly ? preview !== null : exportBlocked === null;

  const exportPng = async () => {
    setBusy(true);
    setNotice(null);
    try {
      const baseName = info.fileName.replace(/\.[^.]+$/, "");
      const target = await platform.pickSaveTarget({
        suggestedName: `${baseName}.png`,
        formats: ["png"],
      });
      if (!target) return;
      // A read-only file is exported as its own preview (already flat, made by the newer version);
      // an editable one is rendered at full resolution with redactions baked in.
      const bytes = readOnly ? preview : await renderFlat(doc, canvasCodec);
      if (!bytes) return;
      await platform.writeGrantedFile(target.token, bytes);
      setNotice({ ok: true, text: `Saved ${target.fileName} to ${target.folder}.` });
    } catch (error) {
      setNotice({
        ok: false,
        text: error instanceof Error ? error.message : "The export did not work.",
      });
    } finally {
      setBusy(false);
    }
  };

  const { source } = doc.manifest;
  return (
    <div className="flex h-screen flex-col bg-background text-foreground">
      <header className="flex flex-wrap items-center gap-x-4 gap-y-2 border-b border-border px-6 py-4">
        <h1 className="min-w-0 truncate text-lg font-semibold" title={info.fileName}>
          {info.fileName}
        </h1>
        {readOnly ? (
          <Badge variant="outline" className="gap-1 border-warning-border text-warning">
            <Lock aria-hidden className="size-3" />
            Read-only
          </Badge>
        ) : null}
        <dl className="ml-auto flex flex-wrap gap-x-5 gap-y-1 text-xs text-muted-foreground">
          <div>
            <dt className="sr-only">Size</dt>
            <dd data-testid="doc-size">{`${String(source.width)} × ${String(source.height)} px`}</dd>
          </div>
          <div>
            <dt className="sr-only">Scale</dt>
            <dd>{`${String(source.scale)}x`}</dd>
          </div>
          <div>
            <dt className="sr-only">Created</dt>
            <dd>{`Created ${formatDate(doc.manifest.createdAt)}`}</dd>
          </div>
          <div>
            <dt className="sr-only">Layers</dt>
            <dd data-testid="doc-layers">
              {doc.project === null
                ? "Layers unavailable"
                : layers === 0
                  ? "No layers"
                  : `${String(layers)} ${layers === 1 ? "layer" : "layers"}`}
            </dd>
          </div>
        </dl>
      </header>

      {warnings.length > 0 ? (
        <ul aria-label="Notices" className="flex flex-col gap-2 border-b border-border px-6 py-3">
          {warnings.map((w) => (
            <li
              key={w.code}
              role="status"
              className="flex items-center gap-2 rounded-md border border-warning-border bg-warning-soft px-3 py-2 text-[13px]"
            >
              <TriangleAlert aria-hidden className="size-4 shrink-0 text-warning" />
              {w.message}
            </li>
          ))}
        </ul>
      ) : null}

      <main className="flex min-h-0 flex-1 items-center justify-center bg-muted p-6">
        {previewUrl ? (
          <img
            src={previewUrl}
            alt="Preview of the screenshot in this file"
            data-testid="doc-preview"
            className="max-h-full max-w-full rounded-md border border-border bg-card object-contain shadow-[0_10px_28px_rgb(0_0_0/0.15)]"
          />
        ) : (
          <p className="text-sm text-muted-foreground">This file has no preview.</p>
        )}
      </main>

      <footer className="flex flex-wrap items-center gap-3 border-t border-border px-6 py-3">
        <p
          role="status"
          aria-live="polite"
          className={
            notice?.ok === false ? "text-sm text-destructive" : "text-sm text-muted-foreground"
          }
        >
          {notice?.text ?? exportBlocked ?? ""}
        </p>
        <div className="ml-auto flex gap-2">
          <Button variant="outline" onClick={onReveal}>
            <FolderSearch aria-hidden />
            {`Show in ${fileManager(os)}`}
          </Button>
          <Button variant="accent" disabled={busy || !canExport} onClick={() => void exportPng()}>
            <Download aria-hidden />
            {exportLabel}
          </Button>
        </div>
      </footer>
    </div>
  );
}
