import { useEffect, useMemo, useState } from "react";
import { Check, History, Trash2 } from "lucide-react";
import { openDocument } from "@/document/read";
import { describeEdits, editedLabel } from "@/editor/export-model";
import { platform, type Recoverable } from "@/platform";
import { Button } from "@/ui/components/button";
import { cn } from "@/ui/lib/utils";

interface Item extends Recoverable {
  /** What the file holds ("3 annotations"), or why it cannot be shown. */
  summary: string;
  /** A small picture of it (the preview inside the file). */
  thumb: string | null;
  /** Whether there is anything in it besides the capture. */
  changed: boolean;
}

/**
 * "Recover unsaved work" (design): the copies the autosave left behind after LumenGrab closed without
 * saving them. Pick the ones to bring back, or discard them all. Recovered documents open in the editor
 * as unsaved documents; nothing is written over a user's file.
 */
export function RecoverWindow() {
  const [items, setItems] = useState<Item[] | null>(null);
  const [picked, setPicked] = useState<Set<string>>(new Set());
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    const guard = { cancelled: false }; // set by the cleanup below, which the compiler cannot follow
    void (async () => {
      const found = await platform.recoveryList();
      const loaded: Item[] = [];
      for (const r of found) {
        try {
          const opened = await openDocument(await platform.recoveryRead(r.id));
          const preview = opened.doc.preview;
          loaded.push({
            ...r,
            summary: opened.doc.project ? describeEdits(opened.doc.project) : "no changes yet",
            thumb: preview
              ? URL.createObjectURL(new Blob([new Uint8Array(preview)], { type: "image/png" }))
              : null,
            changed: opened.doc.project
              ? describeEdits(opened.doc.project) !== "no changes yet"
              : false,
          });
        } catch {
          loaded.push({ ...r, summary: "could not be read", thumb: null, changed: false });
        }
      }
      if (guard.cancelled) return;
      setItems(loaded);
      setPicked(new Set(loaded.filter((i) => i.changed).map((i) => i.id)));
    })();
    return () => {
      guard.cancelled = true;
    };
  }, []);

  useEffect(
    () => () => {
      for (const item of items ?? []) if (item.thumb) URL.revokeObjectURL(item.thumb);
    },
    [items],
  );

  const chosen = useMemo(() => (items ?? []).filter((i) => picked.has(i.id)), [items, picked]);

  const toggle = (id: string) => {
    setPicked((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const recover = async () => {
    setBusy(true);
    try {
      await platform.recoveryOpen(chosen.map((i) => i.id));
    } finally {
      setBusy(false);
    }
  };

  const discard = async () => {
    setBusy(true);
    try {
      await platform.recoveryDelete((items ?? []).map((i) => i.id));
      await platform.closeRecoveryWindow();
    } finally {
      setBusy(false);
    }
  };

  return (
    <main className="flex h-screen items-center justify-center bg-muted p-6">
      <div
        role="dialog"
        aria-label="Recover unsaved work"
        className="flex max-h-full w-[520px] max-w-full flex-col gap-4 rounded-xl border border-border bg-card p-6 shadow-[0_20px_50px_rgb(0_0_0/0.2)]"
      >
        <div className="flex flex-col gap-1.5">
          <h1 className="text-lg font-semibold">Recover unsaved work</h1>
          <p className="text-[13px] text-muted-foreground">
            LumenGrab closed before these captures were saved. Choose the ones you want back.
          </p>
        </div>

        {items === null ? (
          <p className="py-8 text-center text-sm text-muted-foreground" aria-busy="true">
            Looking…
          </p>
        ) : items.length === 0 ? (
          <div className="flex flex-col items-center gap-2 py-8 text-center">
            <History aria-hidden className="size-6 text-muted-foreground" />
            <p className="text-sm font-medium">Nothing to recover</p>
            <p className="text-[13px] text-muted-foreground">Everything you worked on was saved.</p>
          </div>
        ) : (
          <ul
            aria-label="Unsaved documents"
            className="flex min-h-0 flex-col gap-2 overflow-y-auto"
          >
            {items.map((item) => {
              const on = picked.has(item.id);
              return (
                <li key={item.id}>
                  <button
                    type="button"
                    role="checkbox"
                    aria-checked={on}
                    data-recoverable={item.id}
                    className={cn(
                      "flex w-full items-center gap-3 rounded-lg border p-2.5 text-left outline-none focus-visible:ring-2 focus-visible:ring-ring",
                      on ? "border-primary" : "border-border",
                    )}
                    onClick={() => {
                      toggle(item.id);
                    }}
                  >
                    <span
                      aria-hidden
                      className={cn(
                        "flex size-4 shrink-0 items-center justify-center rounded border",
                        on ? "border-primary bg-primary text-primary-foreground" : "border-border",
                      )}
                    >
                      {on ? <Check className="size-3" /> : null}
                    </span>
                    {item.thumb ? (
                      <img
                        src={item.thumb}
                        alt=""
                        className="h-12 w-[72px] shrink-0 rounded border border-border bg-muted object-cover"
                      />
                    ) : (
                      <span className="h-12 w-[72px] shrink-0 rounded border border-border bg-muted" />
                    )}
                    <span className="flex min-w-0 flex-col gap-0.5">
                      <span className="truncate text-sm font-semibold">{item.name}</span>
                      <span className="truncate text-xs text-muted-foreground">
                        {`${editedLabel(item.modifiedMs)} · ${item.summary}`}
                      </span>
                    </span>
                  </button>
                </li>
              );
            })}
          </ul>
        )}

        <div className="flex items-center justify-between gap-2">
          {items && items.length > 0 ? (
            <Button
              variant="ghost"
              className="text-destructive"
              disabled={busy}
              onClick={() => {
                void discard();
              }}
            >
              <Trash2 aria-hidden />
              Discard all
            </Button>
          ) : (
            <span />
          )}
          {items && items.length === 0 ? (
            <Button
              onClick={() => {
                void platform.closeRecoveryWindow();
              }}
            >
              Close
            </Button>
          ) : (
            <Button
              disabled={busy || chosen.length === 0}
              onClick={() => {
                void recover();
              }}
            >
              <History aria-hidden />
              {chosen.length > 0 ? `Recover ${String(chosen.length)}` : "Recover"}
            </Button>
          )}
        </div>
      </div>
    </main>
  );
}
