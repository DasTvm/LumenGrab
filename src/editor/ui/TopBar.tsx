import { useEffect } from "react";
import { Check, Copy, Download, Image as ImageIcon, Redo2, Undo2 } from "lucide-react";
import { Button } from "@/ui/components/button";
import { Tooltip } from "@/ui/components/tooltip";
import { useEditor, useStores, useUi } from "./context";

interface Props {
  fileName: string;
  onExport: () => void;
  onCopy: () => void;
  readOnly: boolean;
}

const isMac = typeof navigator !== "undefined" && /mac/i.test(navigator.platform);
const MOD = isMac ? "⌘" : "Ctrl+";

/**
 * The top bar (design): file name with the dot for unsaved changes, undo and redo, and Export. The
 * Presentation tab and Share are not here yet (M5 and later); the copy button comes with saving.
 */
export function TopBar({ fileName, onExport, onCopy, readOnly }: Props) {
  const { editor } = useStores();
  const dirty = useEditor((s) => s.dirty);
  const canUndo = useEditor((s) => s.canUndo);
  const canRedo = useEditor((s) => s.canRedo);
  const feedback = useUi((s) => s.feedback);
  const { ui } = useStores();
  // "Saved" and "Copied" fade after two seconds (design: Title bar states).
  const at = feedback?.at;
  useEffect(() => {
    if (at === undefined) return;
    const timer = setTimeout(() => {
      ui.getState().clearFeedback(at);
    }, 2000);
    return () => {
      clearTimeout(timer);
    };
  }, [at, ui]);

  return (
    <header className="relative flex h-14 shrink-0 items-center gap-3 border-b border-border bg-card px-4">
      <div className="flex min-w-0 items-center gap-2 text-sm">
        <ImageIcon aria-hidden className="size-4 shrink-0 text-muted-foreground" />
        <span className="truncate" title={fileName} data-testid="editor-file-name">
          {fileName}
        </span>
        {dirty ? (
          <span
            role="img"
            aria-label="Unsaved changes"
            data-testid="unsaved-dot"
            className="size-2 shrink-0 rounded-full bg-primary"
          />
        ) : null}
      </div>
      <span className="h-6 w-px bg-border" />
      <div className="flex gap-1">
        <Tooltip label="Undo" shortcut={`${MOD}Z`} side="bottom">
          <Button
            variant="ghost"
            size="icon"
            className="size-8"
            aria-label="Undo"
            disabled={!canUndo || readOnly}
            onClick={() => {
              editor.getState().undo();
            }}
          >
            <Undo2 aria-hidden />
          </Button>
        </Tooltip>
        <Tooltip label="Redo" shortcut={isMac ? "⇧⌘Z" : "Ctrl+Y"} side="bottom">
          <Button
            variant="ghost"
            size="icon"
            className="size-8"
            aria-label="Redo"
            disabled={!canRedo || readOnly}
            onClick={() => {
              editor.getState().redo();
            }}
          >
            <Redo2 aria-hidden />
          </Button>
        </Tooltip>
      </div>
      <span className="flex-1" />
      <Tooltip label="Copy image" shortcut={isMac ? "⇧⌘C" : "Ctrl+Shift+C"} side="bottom">
        <Button
          variant="ghost"
          size="icon"
          className="size-9"
          aria-label="Copy image"
          onClick={onCopy}
        >
          <Copy aria-hidden />
        </Button>
      </Tooltip>
      <Button variant="outline" className="h-8 gap-1.5 px-3 text-sm" onClick={onExport}>
        <Download aria-hidden className="size-4" />
        Export
      </Button>
      {feedback ? (
        <div
          role="status"
          data-testid="feedback-pill"
          className="absolute top-full right-4 z-10 mt-2 flex items-center gap-1.5 rounded-md bg-primary px-2.5 py-1 text-[13px] text-primary-foreground"
        >
          <Check aria-hidden className="size-3.5 text-brand" />
          {feedback.kind === "saved" ? "Saved" : "Copied to clipboard"}
        </div>
      ) : null}
    </header>
  );
}
