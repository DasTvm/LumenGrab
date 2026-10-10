import type { ReactNode } from "react";
import { Eye, FileX, FolderSearch, Lock, RefreshCw, X } from "lucide-react";
import { Button } from "@/ui/components/button";
import { cn } from "@/ui/lib/utils";

/** A dialog of the Pencil frame "File Errors": icon in a circle, title, text, a one-line detail, two buttons. */
function DialogShell({
  tone,
  icon,
  title,
  body,
  detail,
  children,
}: {
  tone: "error" | "warning";
  icon: ReactNode;
  title: string;
  body: string;
  detail: string;
  children: ReactNode;
}) {
  return (
    <div
      role="alertdialog"
      aria-labelledby="document-dialog-title"
      aria-describedby="document-dialog-body"
      className="flex w-[500px] max-w-full flex-col gap-4 rounded-xl border border-border bg-card p-6 text-card-foreground shadow-[0_20px_50px_rgb(0_0_0/0.25)]"
    >
      <div className="flex gap-3.5">
        <span
          className={cn(
            "flex size-10 shrink-0 items-center justify-center rounded-full",
            tone === "error"
              ? "bg-destructive/10 text-destructive"
              : "bg-warning-soft text-warning",
          )}
        >
          {icon}
        </span>
        <div className="flex min-w-0 flex-1 flex-col gap-1.5">
          <h2 id="document-dialog-title" className="text-base font-semibold">
            {title}
          </h2>
          <p id="document-dialog-body" className="text-[13px] leading-normal text-muted-foreground">
            {body}
          </p>
        </div>
      </div>
      <p
        data-testid="document-dialog-detail"
        className="rounded-md bg-muted px-3 py-2.5 font-mono text-xs break-words"
      >
        {detail}
      </p>
      <div className="flex justify-end gap-2">{children}</div>
    </div>
  );
}

/** "Can't open this file". The original file was not changed. */
export function CantOpenDialog({
  message,
  detail,
  showLabel,
  onShow,
  onClose,
}: {
  message: string;
  detail: string;
  /** "Show in Finder" or "Show in Explorer". */
  showLabel: string;
  onShow: () => void;
  onClose: () => void;
}) {
  return (
    <DialogShell
      tone="error"
      icon={<FileX aria-hidden className="size-5" />}
      title="Can't open this file"
      body={message}
      detail={detail}
    >
      <Button variant="outline" onClick={onShow}>
        <FolderSearch aria-hidden />
        {showLabel}
      </Button>
      <Button autoFocus onClick={onClose}>
        <X aria-hidden />
        Close
      </Button>
    </DialogShell>
  );
}

/** "Opened read-only": a file from a newer version can be viewed but not edited. */
export function ReadOnlyDialog({
  fileVersion,
  supportedVersion,
  onKeepViewing,
  onCheckForUpdates,
}: {
  fileVersion: number;
  supportedVersion: number;
  onKeepViewing: () => void;
  onCheckForUpdates: () => void;
}) {
  return (
    <DialogShell
      tone="warning"
      icon={<Lock aria-hidden className="size-5" />}
      title="Opened read-only"
      body="This file was created with a newer version of LumenGrab. You can view it, but editing is disabled so nothing gets lost."
      detail={`File version ${String(fileVersion)} · LumenGrab supports up to ${String(supportedVersion)}`}
    >
      <Button variant="outline" autoFocus onClick={onKeepViewing}>
        <Eye aria-hidden />
        Keep viewing
      </Button>
      <Button variant="accent" onClick={onCheckForUpdates}>
        <RefreshCw aria-hidden />
        Check for updates
      </Button>
    </DialogShell>
  );
}
