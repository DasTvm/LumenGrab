import { TriangleAlert } from "lucide-react";
import { Button } from "@/ui/components/button";
import { Modal } from "@/ui/components/modal";

export interface Failure {
  /** "Could not save" or "Could not export". */
  title: string;
  /** "Your work is still open. Nothing was lost." */
  body: string;
  /** The reason in plain words. */
  reason: string;
  /** What the system said. */
  detail: string;
  retry: () => void;
  /** The third button: "Save elsewhere…" or "Choose folder…". */
  elsewhere: { label: string; run: () => void };
}

/** "Could not save" / "Could not export" (design): the reason, the system's words, and three ways on. */
export function FailureDialog({ failure, onClose }: { failure: Failure; onClose: () => void }) {
  return (
    <Modal label={failure.title} onClose={onClose}>
      <div className="flex gap-3.5">
        <span className="flex size-10 shrink-0 items-center justify-center rounded-full bg-destructive/10 text-destructive">
          <TriangleAlert aria-hidden className="size-5" />
        </span>
        <div className="flex min-w-0 flex-1 flex-col gap-1">
          <h2 className="text-base font-semibold">{failure.title}</h2>
          <p className="text-[13px] text-muted-foreground">{failure.body}</p>
        </div>
      </div>
      <div className="flex flex-col gap-1 rounded-md bg-muted px-3 py-2.5 text-[13px]">
        <p data-testid="failure-reason">{failure.reason}</p>
        <p className="font-mono text-xs break-words text-muted-foreground">{`Details: ${failure.detail}`}</p>
      </div>
      <div className="flex justify-end gap-2">
        <Button variant="ghost" onClick={onClose}>
          Cancel
        </Button>
        <Button
          variant="outline"
          onClick={() => {
            onClose();
            failure.elsewhere.run();
          }}
        >
          {failure.elsewhere.label}
        </Button>
        <Button
          data-autofocus
          onClick={() => {
            onClose();
            failure.retry();
          }}
        >
          Retry
        </Button>
      </div>
    </Modal>
  );
}

/** Words for the usual causes (the system's own message is kept as the detail). */
export function explain(
  error: unknown,
  doing: "save" | "export",
): { reason: string; detail: string } {
  const detail =
    error instanceof Error ? error.message : typeof error === "string" ? error : "unknown error";
  const lower = detail.toLowerCase();
  if (lower.includes("no space") || lower.includes("os error 28") || lower.includes("disk full")) {
    return { reason: "There is not enough space on the disk.", detail };
  }
  if (
    lower.includes("permission") ||
    lower.includes("os error 13") ||
    lower.includes("access is denied") ||
    lower.includes("os error 5")
  ) {
    return { reason: "LumenGrab is not allowed to write to that folder.", detail };
  }
  if (lower.includes("read-only") || lower.includes("os error 30")) {
    return { reason: "That location is read-only.", detail };
  }
  if (
    lower.includes("not found") ||
    lower.includes("os error 2") ||
    lower.includes("no such file")
  ) {
    return { reason: "That folder is no longer there.", detail };
  }
  return {
    reason: doing === "save" ? "The file could not be written." : "The image could not be written.",
    detail,
  };
}
