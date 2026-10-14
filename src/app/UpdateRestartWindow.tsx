import { useEffect, useState } from "react";
import { RefreshCw } from "lucide-react";
import { platform, type UnsavedDocument } from "@/platform";
import { Button } from "@/ui/components/button";

const KIND: Record<UnsavedDocument["kind"], string> = {
  file: "Document",
  capture: "New screenshot",
  recovered: "Recovered work",
};

/**
 * "Install the update now?" (`?window=update-restart`, design: Update restart): the restart needs to close
 * LumenGrab, so every document with unsaved changes is listed, and each one asks "Save changes?" in its own
 * window before anything is installed. Later changes nothing.
 */
export function UpdateRestartWindow() {
  const [documents, setDocuments] = useState<UnsavedDocument[] | null>(null);
  useEffect(() => {
    void platform.getUnsavedDocuments().then(setDocuments, () => {
      setDocuments([]);
    });
  }, []);
  const count = documents?.length ?? 0;
  return (
    <main className="flex h-screen flex-col justify-between gap-5 bg-background p-7 text-foreground">
      <div className="flex min-h-0 flex-col gap-4">
        <div className="flex items-center gap-3.5">
          <span className="flex size-11 shrink-0 items-center justify-center rounded-xl bg-brand/30">
            <RefreshCw aria-hidden className="size-[22px]" />
          </span>
          <h1 className="text-lg font-semibold">Install the update now?</h1>
        </div>
        <p className="text-sm leading-normal text-muted-foreground">
          LumenGrab is ready to update. The app restarts to finish the update. Nothing is lost:
          you'll be asked about each unsaved document first.
        </p>
        {count > 0 ? (
          <section
            aria-label="Documents with unsaved changes"
            className="flex min-h-0 flex-col gap-2"
          >
            <h2 className="text-xs font-semibold tracking-wide text-muted-foreground uppercase">
              {`${String(count)} ${count === 1 ? "document" : "documents"} with unsaved changes`}
            </h2>
            <ul className="overflow-auto rounded-lg border border-border">
              {documents?.map((d) => (
                <li
                  key={d.label}
                  className="flex items-center justify-between gap-3 border-b border-border px-3.5 py-2.5 last:border-b-0"
                >
                  <div className="flex min-w-0 flex-col">
                    <span className="truncate text-sm font-medium">{d.name}</span>
                    <span className="text-xs text-muted-foreground">{`Editor · ${KIND[d.kind]}`}</span>
                  </div>
                  <span className="shrink-0 rounded-sm bg-warning/10 px-2 py-0.5 text-xs font-medium text-warning">
                    Unsaved
                  </span>
                </li>
              ))}
            </ul>
          </section>
        ) : null}
        <p className="text-xs text-muted-foreground">
          Unsaved work is also kept in the recovery folder, in case the restart is interrupted.
        </p>
      </div>
      <div className="flex justify-end gap-2">
        <Button
          variant="outline"
          onClick={() => {
            void platform.dismissUpdateRestart();
          }}
        >
          Later
        </Button>
        <Button
          variant="accent"
          autoFocus
          onClick={() => {
            void platform.confirmUpdateRestart();
          }}
        >
          Install and restart
        </Button>
      </div>
    </main>
  );
}
