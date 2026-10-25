import { useCallback, useEffect, useState } from "react";
import { Check, FolderOpen, Info } from "lucide-react";
import {
  DEFAULT_SETTINGS,
  platform,
  type HistoryFilters,
  type HistoryKeep,
  type HistoryUsage,
  type Settings,
} from "@/platform";
import { Button } from "@/ui/components/button";
import { Modal } from "@/ui/components/modal";
import { Switch } from "@/ui/components/switch";
import { ToastBar } from "@/ui/components/toast";
import { formatBytes } from "@/ui/lib/format";
import { cn } from "@/ui/lib/utils";
import { Divider, Row, Section } from "./settings-parts";

const KEEP_OPTIONS: { value: HistoryKeep; label: string }[] = [
  { value: "week", label: "1 week" },
  { value: "month", label: "1 month" },
  { value: "quarter", label: "3 months" },
  { value: "year", label: "1 year" },
  { value: "forever", label: "Forever" },
];

/** Settings > History (design: "Settings / History"): what the history keeps, how it is shown, what it costs. */
export function HistoryPage({
  settings,
  onChange,
  saveError,
}: {
  settings: Settings | null;
  onChange: (next: Settings) => void;
  saveError: string | null;
}) {
  const loaded = settings !== null;
  const current = settings ?? DEFAULT_SETTINGS;
  const history = current.history;
  const setHistory = (patch: Partial<Settings["history"]>) => {
    onChange({ ...current, history: { ...history, ...patch } });
  };
  const [usage, setUsage] = useState<HistoryUsage | null>(null);
  const [asking, setAsking] = useState(false);
  const [done, setDone] = useState<string | null>(null);
  const [problem, setProblem] = useState<string | null>(null);

  const refresh = useCallback(() => {
    platform.historyUsage().then(setUsage, () => {
      setUsage(null);
    });
  }, []);
  useEffect(refresh, [refresh]);
  useEffect(() => {
    if (!done) return;
    const timer = setTimeout(() => {
      setDone(null);
    }, 4000);
    return () => {
      clearTimeout(timer);
    };
  }, [done]);

  const clear = () => {
    const freed = usage?.bytes ?? 0;
    setAsking(false);
    platform.historyClear().then(
      () => {
        setProblem(null);
        setDone(`History cleared · ${formatBytes(freed)} freed`);
        refresh();
      },
      (e: unknown) => {
        setProblem(e instanceof Error ? e.message : "The history could not be cleared.");
      },
    );
  };

  return (
    <div className="flex max-w-[836px] flex-col gap-7">
      <h1 className="text-xl font-semibold">History</h1>
      {saveError || problem ? (
        <p role="alert" className="text-sm text-destructive">
          {saveError ?? problem}
        </p>
      ) : null}

      <Section title="Keeping">
        <Row
          title="Keep a history of my captures"
          description="Every capture is kept here so you can find, copy and pin it again."
        >
          <Switch
            checked={history.enabled}
            disabled={!loaded}
            aria-label="Keep a history of my captures"
            onCheckedChange={(enabled) => {
              setHistory({ enabled });
            }}
          />
        </Row>
        <Row
          title="Keep captures for"
          description="Older captures are removed from the history automatically."
        >
          <select
            aria-label="Keep captures for"
            disabled={!loaded || !history.enabled}
            value={history.keep}
            onChange={(e) => {
              setHistory({ keep: e.target.value as HistoryKeep });
            }}
            className="w-[140px] rounded-md border border-border bg-background px-3 py-[7px] text-sm outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-50"
          >
            {KEEP_OPTIONS.map((o) => (
              <option key={o.value} value={o.value}>
                {o.label}
              </option>
            ))}
          </select>
        </Row>
        <Row
          title="Keep a picture of text captures"
          description="Off: a text capture copies the text and leaves nothing behind."
        >
          <Switch
            checked={history.textPicture}
            disabled={!loaded || !history.enabled}
            aria-label="Keep a picture of text captures"
            onCheckedChange={(textPicture) => {
              setHistory({ textPicture });
            }}
          />
        </Row>
        <div className="flex gap-3 rounded-lg border border-border bg-muted/50 p-4 text-sm">
          <Info className="mt-0.5 size-4 shrink-0 text-muted-foreground" aria-hidden />
          <div className="flex flex-col gap-1">
            <span className="font-medium">Stays on this computer</span>
            <span className="text-xs text-muted-foreground">
              The history keeps a copy of each capture in a LumenGrab folder on this computer.
              Nothing is uploaded. Files you saved yourself are never touched or removed.
            </span>
          </div>
        </div>
        {!history.enabled && loaded ? (
          <p className="text-xs text-muted-foreground" role="status">
            History is off. New captures are not kept. What is already here stays until you clear
            it.
          </p>
        ) : null}
      </Section>
      <Divider />

      <Section title="View">
        <Row
          title="Filters in the history"
          description="Where you pick All, Pinned and where a capture came from."
        >
          <span />
        </Row>
        <div role="radiogroup" aria-label="Filters in the history" className="flex gap-4">
          <FilterCard
            value="sidebar"
            title="Sidebar"
            text="A list on the left. Shows counts."
            selected={history.filters === "sidebar"}
            disabled={!loaded}
            onSelect={() => {
              setHistory({ filters: "sidebar" });
            }}
          />
          <FilterCard
            value="chips"
            title="Filter chips"
            text="Pills above the grid. More room for captures."
            selected={history.filters === "chips"}
            disabled={!loaded}
            onSelect={() => {
              setHistory({ filters: "chips" });
            }}
          />
        </div>
      </Section>
      <Divider />

      <Section title="Storage">
        <Row
          title="Space used"
          description={
            usage
              ? `${String(usage.count)} capture${usage.count === 1 ? "" : "s"} · ${formatBytes(usage.bytes)}`
              : "…"
          }
        >
          <Button
            variant="outline"
            size="sm"
            onClick={() => {
              void platform.historyOpenFolder();
            }}
          >
            <FolderOpen aria-hidden /> Open history folder
          </Button>
        </Row>
      </Section>
      <Divider />

      <Section title="Clear">
        <Row
          title="Clear history"
          description="Removes every capture from the history and frees the space. Files you saved yourself stay where they are."
        >
          <Button
            variant="outline"
            size="sm"
            className="border-destructive text-destructive hover:bg-destructive/10"
            disabled={!usage || usage.count === 0}
            onClick={() => {
              setAsking(true);
            }}
          >
            Clear history…
          </Button>
        </Row>
      </Section>

      {asking ? (
        <Modal
          label="Clear history?"
          className="w-[440px]"
          onClose={() => {
            setAsking(false);
          }}
        >
          <h2 className="text-lg font-semibold">Clear history?</h2>
          <p className="text-sm text-muted-foreground">
            This removes {String(usage?.count ?? 0)} capture{usage?.count === 1 ? "" : "s"} from the
            history and frees {formatBytes(usage?.bytes ?? 0)}. Files you saved yourself stay where
            they are. This can&apos;t be undone.
          </p>
          <div className="flex justify-end gap-2">
            <Button
              variant="outline"
              onClick={() => {
                setAsking(false);
              }}
            >
              Cancel
            </Button>
            <Button variant="destructive" onClick={clear}>
              Clear history
            </Button>
          </div>
        </Modal>
      ) : null}
      {done ? (
        <div className="pointer-events-none fixed bottom-6 left-6 z-40">
          <ToastBar icon={Check}>{done}</ToastBar>
        </div>
      ) : null}
    </div>
  );
}

/** One of the two layouts, with a small drawing of the window it makes. */
function FilterCard({
  value,
  title,
  text,
  selected,
  disabled,
  onSelect,
}: {
  value: HistoryFilters;
  title: string;
  text: string;
  selected: boolean;
  disabled: boolean;
  onSelect: () => void;
}) {
  return (
    <button
      type="button"
      role="radio"
      aria-checked={selected}
      disabled={disabled}
      onClick={onSelect}
      className={cn(
        "flex flex-1 flex-col gap-3 rounded-lg border p-3 text-left outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-50",
        selected ? "border-2 border-primary" : "border-border hover:bg-muted/50",
      )}
    >
      <div aria-hidden className="flex h-[76px] gap-1.5 rounded-md bg-muted p-2">
        {value === "sidebar" ? <div className="w-[22%] rounded-sm bg-brand/60" /> : null}
        <div className="flex flex-1 flex-col gap-1.5">
          {value === "chips" ? (
            <div className="flex gap-1">
              {[0, 1, 2].map((i) => (
                <span key={i} className="h-2 w-6 rounded-full bg-brand/60" />
              ))}
            </div>
          ) : null}
          <div className="grid flex-1 grid-cols-4 gap-1">
            {Array.from({ length: value === "chips" ? 8 : 6 }, (_, i) => (
              <span key={i} className="rounded-sm bg-card" />
            ))}
          </div>
        </div>
      </div>
      <span className="flex flex-col gap-0.5">
        <span className="flex items-center gap-2 text-sm font-medium">
          <span
            aria-hidden
            className={cn(
              "flex size-3.5 items-center justify-center rounded-full border",
              selected ? "border-primary" : "border-border",
            )}
          >
            {selected ? <span className="size-2 rounded-full bg-primary" /> : null}
          </span>
          {title}
        </span>
        <span className="text-xs text-muted-foreground">{text}</span>
      </span>
    </button>
  );
}
