import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import {
  AppWindow,
  Check,
  Clock,
  Copy,
  FolderSearch,
  Image as ImageIcon,
  LayoutGrid,
  List,
  MoreHorizontal,
  Monitor,
  Pencil,
  Pin,
  Plus,
  ScanLine,
  SquareDashed,
  Trash2,
  TriangleAlert,
} from "lucide-react";
import {
  DEFAULT_SETTINGS,
  platform,
  PlatformError,
  type HistoryEntry,
  type HistoryFilters,
  type HistorySource,
  type HotkeyInfo,
  type Settings,
} from "@/platform";
import { formatKey } from "@/platform/keys";
import { currentOs } from "@/platform/os";
import { Button } from "@/ui/components/button";
import { EmptyState } from "@/ui/components/empty-state";
import { Keycap } from "@/ui/components/keycap";
import { LogoMark } from "@/ui/components/logo-mark";
import { Menu, type MenuItem } from "@/ui/components/menu";
import { Modal } from "@/ui/components/modal";
import { SearchField } from "@/ui/components/search-field";
import { ToastBar } from "@/ui/components/toast";
import { formatBytes } from "@/ui/lib/format";
import { cn } from "@/ui/lib/utils";
import {
  cardLine,
  countFilters,
  filterEntries,
  groupByDay,
  listWhen,
  size,
  sourceLabel,
  SOURCES,
  type DayGroup,
  type HistoryFilter,
} from "./history/model";

const isMac = currentOs() === "macos";
const MOD = isMac ? "⌘" : "Ctrl+";
const SHIFT = isMac ? "⇧" : "Shift+";

const SOURCE_ICONS: Record<HistorySource, typeof Monitor> = {
  area: SquareDashed,
  window: AppWindow,
  fullscreen: Monitor,
  allinone: ScanLine,
};

interface Message {
  id: number;
  text: string;
  tone?: "error";
  action?: { label: string; run: () => void };
}

/**
 * The History window (design: "M6 / History"): every capture the history kept, newest first, with
 * filters, a search, a grid or a list, and the actions that make a capture useful again.
 * The page never sees a path: everything goes by the id of the entry.
 */
export function HistoryWindow() {
  const [data, setData] = useState<{ entries: HistoryEntry[]; off: boolean } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [settings, setSettings] = useState<Settings>(DEFAULT_SETTINGS);
  const [hotkeys, setHotkeys] = useState<HotkeyInfo[]>([]);
  const [filter, setFilter] = useState<HistoryFilter>("all");
  const [query, setQuery] = useState("");
  const [view, setView] = useState<"grid" | "list">("grid");
  const [selecting, setSelecting] = useState(false);
  const [selected, setSelected] = useState<ReadonlySet<string>>(new Set());
  const [menu, setMenu] = useState<{ id: string; x: number; y: number } | null>(null);
  const [asking, setAsking] = useState<string[] | null>(null);
  const [message, setMessage] = useState<Message | null>(null);
  const counter = useRef(0);

  const say = useCallback((text: string, extra: Partial<Message> = {}) => {
    counter.current += 1;
    setMessage({ id: counter.current, text, ...extra });
  }, []);

  const load = useCallback(() => {
    platform.historyList().then(
      (list) => {
        setError(null);
        setData(list);
      },
      (e: unknown) => {
        setError(e instanceof Error ? e.message : "The history could not be read.");
      },
    );
    platform.getSettingsInfo().then(
      (info) => {
        setSettings(info.settings);
        setHotkeys(info.hotkeys);
      },
      () => undefined,
    );
  }, []);

  // New captures arrive while the window is open, and the settings may have changed in the other window.
  useEffect(() => {
    load();
    window.addEventListener("focus", load);
    return () => {
      window.removeEventListener("focus", load);
    };
  }, [load]);

  // A pin that was closed in its own window is no longer marked here.
  useEffect(() => {
    let off: (() => void) | undefined;
    let disposed = false;
    void platform.onPinsChanged(load).then((unlisten) => {
      if (disposed) unlisten();
      else off = unlisten;
    });
    return () => {
      disposed = true;
      off?.();
    };
  }, [load]);

  useEffect(() => {
    if (!message) return;
    const timer = setTimeout(
      () => {
        setMessage((current) => (current?.id === message.id ? null : current));
      },
      message.action ? 8000 : 4000,
    );
    return () => {
      clearTimeout(timer);
    };
  }, [message]);

  const entries = useMemo(() => data?.entries ?? [], [data]);
  const counts = useMemo(() => countFilters(entries), [entries]);
  const shown = useMemo(() => filterEntries(entries, filter, query), [entries, filter, query]);
  const groups = useMemo(() => groupByDay(shown), [shown]);
  const filters: HistoryFilters = settings.history.filters;
  const searching = query.trim() !== "";

  const fail = (e: unknown, fallback: string) => {
    say(e instanceof Error ? e.message : fallback, { tone: "error" });
  };

  const copy = (id: string) => {
    platform.historyCopy(id).then(
      () => {
        say("Copied to clipboard");
      },
      (e: unknown) => {
        fail(e, "The capture could not be copied.");
      },
    );
  };
  const edit = (id: string) => {
    platform.historyEdit(id).catch((e: unknown) => {
      fail(e, "The capture could not be opened.");
    });
  };
  const reveal = (id: string) => {
    platform.historyReveal(id).catch((e: unknown) => {
      fail(e, "The file could not be shown.");
    });
  };
  const saveCopy = (id: string) => {
    platform.historySaveCopy(id).then(
      (folder) => {
        if (folder) say(`Saved to ${folder}`);
      },
      (e: unknown) => {
        fail(e, "The capture could not be saved.");
      },
    );
  };
  const remove = (ids: string[]) => {
    platform.historyRemove(ids).then(
      () => {
        say(
          ids.length === 1 ? "Removed from history" : `${String(ids.length)} removed from history`,
        );
        setSelected(new Set());
        load();
      },
      (e: unknown) => {
        fail(e, "The capture could not be removed.");
      },
    );
  };
  const trash = (ids: string[]) => {
    setAsking(null);
    platform.historyTrash(ids).then(
      () => {
        setSelected(new Set());
        setSelecting(false);
        load();
        say("Moved to Trash", {
          action: {
            label: "Undo",
            run: () => {
              platform.historyUndoTrash(ids).then(load, (e: unknown) => {
                fail(e, "Undo did not work.");
              });
            },
          },
        });
      },
      (e: unknown) => {
        fail(e, "The capture could not be moved to the Trash.");
      },
    );
  };
  /** One capture goes at once (it can be undone); several ask first, as the design shows. */
  const askToTrash = (ids: string[]) => {
    if (ids.length > 1) setAsking(ids);
    else trash(ids);
  };
  const copyText = (id: string) => {
    say("Reading text…");
    platform.recognizeHistoryText(id).then(
      async (found) => {
        if (!found.text) {
          say(found.codes.length > 0 ? "No text found, but a QR code" : "No text found");
          return;
        }
        await platform.copyText(found.text);
        say(`Text copied · ${String(found.words)} ${found.words === 1 ? "word" : "words"}`);
      },
      (e: unknown) => {
        fail(
          e instanceof PlatformError && e.code === "no-language-pack"
            ? new Error("No language pack for text recognition. Windows needs one to read text.")
            : e,
          "The text could not be read.",
        );
      },
    );
  };
  const pin = (ids: string[]) => {
    const results = ids.map((id) => platform.pinHistory(id));
    Promise.all(results).then(
      () => {
        load();
      },
      (e: unknown) => {
        fail(e, "The capture could not be pinned.");
      },
    );
  };
  const newCapture = () => {
    void platform.startCapture(settings.defaultMode, true);
  };

  const toggle = (id: string) => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };
  const stopSelecting = () => {
    setSelecting(false);
    setSelected(new Set());
  };

  const menuItems = (id: string): MenuItem[] => {
    const entry = entries.find((e) => e.id === id);
    const gone = entry?.missing ?? false;
    return [
      {
        label: "Open in editor",
        keys: "⏎",
        run: () => {
          edit(id);
        },
        disabled: gone,
      },
      {
        label: "Copy image",
        keys: `${MOD}C`,
        run: () => {
          copy(id);
        },
        disabled: gone,
      },
      {
        label: "Copy text",
        keys: `${SHIFT}${MOD}C`,
        run: () => {
          copyText(id);
        },
        disabled: gone,
      },
      {
        label: "Pin",
        keys: "P",
        run: () => {
          pin([id]);
        },
        disabled: gone,
      },
      {
        label: "Save as…",
        keys: `${MOD}S`,
        run: () => {
          saveCopy(id);
        },
        disabled: gone,
      },
      {
        label: "Show in folder",
        keys: `${MOD}R`,
        run: () => {
          reveal(id);
        },
      },
      {
        label: "Remove from History",
        run: () => {
          remove([id]);
        },
        separator: true,
      },
      {
        label: "Move to Trash",
        keys: "⌫",
        run: () => {
          trash([id]);
        },
        danger: true,
        disabled: gone,
      },
    ];
  };

  const onCardKey = (e: React.KeyboardEvent, entry: HistoryEntry) => {
    const mod = e.metaKey || e.ctrlKey;
    if (mod && !e.shiftKey && e.key.toLowerCase() === "c") {
      e.preventDefault();
      if (!entry.missing) copy(entry.id);
    } else if (mod && e.key.toLowerCase() === "s") {
      e.preventDefault();
      if (!entry.missing) saveCopy(entry.id);
    } else if (mod && e.key.toLowerCase() === "r") {
      e.preventDefault();
      reveal(entry.id);
    } else if (mod && e.shiftKey && e.key.toLowerCase() === "c") {
      e.preventDefault();
      if (!entry.missing) copyText(entry.id);
    } else if (!mod && e.key.toLowerCase() === "p") {
      e.preventDefault();
      if (!entry.missing) pin([entry.id]);
    } else if (e.key === "Delete" || e.key === "Backspace") {
      e.preventDefault();
      if (entry.missing) remove([entry.id]);
      else askToTrash([entry.id]);
    }
  };

  const title =
    filter === "all" ? "All captures" : filter === "pinned" ? "Pinned" : sourceLabel(filter);
  const countText = searching
    ? `${String(shown.length)} result${shown.length === 1 ? "" : "s"}`
    : String(shown.length);

  const toolbar = (
    <header className="flex shrink-0 items-center gap-3 border-b border-border px-6 py-4">
      {selecting ? (
        <>
          <h1 className="text-lg font-semibold">{String(selected.size)} selected</h1>
          <div className="flex-1" />
          <Button
            variant="ghost"
            size="sm"
            onClick={() => {
              setSelected(new Set(shown.map((e) => e.id)));
            }}
          >
            Select all
          </Button>
          <Button variant="outline" size="sm" onClick={stopSelecting}>
            Done
          </Button>
        </>
      ) : (
        <>
          <h1 className="flex items-baseline gap-2 text-lg font-semibold">
            {title}
            <span className="text-sm font-normal text-muted-foreground" data-testid="count">
              {countText}
            </span>
          </h1>
          <div className="flex-1" />
          <SearchField
            label="Search captures"
            placeholder="Search captures"
            value={query}
            onValueChange={setQuery}
            className="w-[240px]"
          />
          <div role="group" aria-label="View" className="flex gap-0.5 rounded-md bg-muted p-0.5">
            {(
              [
                ["grid", LayoutGrid, "Grid"],
                ["list", List, "List"],
              ] as const
            ).map(([id, Icon, label]) => (
              <button
                key={id}
                type="button"
                aria-label={label}
                aria-pressed={view === id}
                onClick={() => {
                  setView(id);
                }}
                className={cn(
                  "rounded p-1.5 outline-none focus-visible:ring-2 focus-visible:ring-ring",
                  view === id ? "bg-brand text-brand-foreground" : "text-muted-foreground",
                )}
              >
                <Icon className="size-4" aria-hidden />
              </button>
            ))}
          </div>
          <Button
            variant="outline"
            size="sm"
            disabled={entries.length === 0}
            onClick={() => {
              setSelecting(true);
            }}
          >
            Select
          </Button>
          {filters === "chips" ? (
            <Button variant="accent" size="sm" onClick={newCapture}>
              <Plus aria-hidden /> New capture
            </Button>
          ) : null}
        </>
      )}
    </header>
  );

  const chips =
    filters === "chips" && !selecting ? (
      <div
        role="group"
        aria-label="Filters"
        className="flex shrink-0 flex-wrap gap-2 border-b border-border px-6 py-3"
      >
        {FILTER_LIST.map(({ id, label }) => (
          <button
            key={id}
            type="button"
            aria-pressed={filter === id}
            onClick={() => {
              setFilter(id);
            }}
            className={cn(
              "flex items-center gap-1.5 rounded-full border px-3 py-1 text-sm outline-none focus-visible:ring-2 focus-visible:ring-ring",
              filter === id
                ? "border-transparent bg-brand font-medium text-brand-foreground"
                : "border-border text-muted-foreground hover:bg-accent",
            )}
          >
            {label}
            <span className="text-xs opacity-70">{counts[id]}</span>
          </button>
        ))}
      </div>
    ) : null;

  let body: ReactNode;
  if (error) {
    body = (
      <EmptyState
        role="alert"
        icon={TriangleAlert}
        title="History can't be read"
        actions={
          <>
            <Button
              variant="outline"
              onClick={() => {
                platform.historyReload().then(load, (e: unknown) => {
                  fail(e, "The history is still unreadable.");
                });
              }}
            >
              Try again
            </Button>
            <Button
              variant="outline"
              onClick={() => {
                void platform.historyOpenFolder();
              }}
            >
              Open history folder
            </Button>
            <Button
              variant="destructive"
              onClick={() => {
                platform.historyReset().then(load, (e: unknown) => {
                  fail(e, "The history could not be reset.");
                });
              }}
            >
              Start with a new history
            </Button>
          </>
        }
      >
        LumenGrab couldn&apos;t open the list of your captures. Your image files are not affected.
        <br />
        <span className="text-xs">
          Details: {error.replace(/^The history can't be read: /, "").replace(/\.$/, "")}
        </span>
      </EmptyState>
    );
  } else if (!data) {
    body = (
      <div aria-busy="true" aria-label="Loading captures" className="grid grid-cols-4 gap-4 p-6">
        {Array.from({ length: 8 }, (_, i) => (
          <div key={i} className="aspect-[4/3] animate-pulse rounded-lg bg-muted" />
        ))}
      </div>
    );
  } else if (entries.length === 0) {
    body = (
      <EmptyState
        icon={ImageIcon}
        title="No captures yet"
        actions={
          <Button variant="accent" onClick={newCapture}>
            <Plus aria-hidden /> New capture
          </Button>
        }
      >
        Everything you capture shows up here. Use a shortcut to take your first one.
        <span className="mt-4 flex flex-col gap-2">
          {hotkeys
            .filter((h) => ["capture", "area", "window", "fullscreen"].includes(h.id))
            .map((h) => (
              <span key={h.id} className="flex items-center justify-between gap-6 text-left">
                <span className="text-sm text-foreground">{HOTKEY_LABEL[h.id]}</span>
                <span className="flex gap-1">
                  {h.keys.map((k) => (
                    <Keycap key={k}>{formatKey(k, currentOs())}</Keycap>
                  ))}
                </span>
              </span>
            ))}
        </span>
      </EmptyState>
    );
  } else if (shown.length === 0) {
    body = searching ? (
      <EmptyState
        icon={FolderSearch}
        title={`No results for “${query.trim()}”`}
        actions={
          <Button
            variant="outline"
            onClick={() => {
              setQuery("");
            }}
          >
            Clear search
          </Button>
        }
      >
        Nothing matches that word. Try another one, or clear the search.
      </EmptyState>
    ) : (
      <EmptyState
        icon={Pin}
        title={filter === "pinned" ? "Nothing pinned yet" : `No ${title.toLowerCase()} captures`}
        actions={
          <Button
            variant="outline"
            onClick={() => {
              setFilter("all");
            }}
          >
            Show all captures
          </Button>
        }
      >
        {filter === "pinned"
          ? "Pin a capture and it floats above your other windows. Pinned captures are listed here."
          : "No capture of this kind is in the history."}
      </EmptyState>
    );
  } else {
    body = (
      <div className="flex flex-col gap-6 p-6">
        {data.off ? (
          <div
            role="status"
            className="flex items-center gap-4 rounded-lg border border-border bg-muted/50 px-4 py-3"
          >
            <Clock className="size-4 shrink-0 text-muted-foreground" aria-hidden />
            <div className="flex flex-1 flex-col">
              <span className="text-sm font-medium">History is off</span>
              <span className="text-xs text-muted-foreground">
                New captures are not kept here. What is below was saved earlier.
              </span>
            </div>
            <Button
              variant="outline"
              size="sm"
              onClick={() => {
                platform
                  .saveSettings({ ...settings, history: { ...settings.history, enabled: true } })
                  .then(load, (e: unknown) => {
                    fail(e, "The setting could not be saved.");
                  });
              }}
            >
              Turn on
            </Button>
          </div>
        ) : null}
        {view === "list" ? (
          <ListView
            groups={groups}
            selecting={selecting}
            selected={selected}
            onToggle={toggle}
            onOpen={edit}
            onKey={onCardKey}
            onMenu={(id, x, y) => {
              setMenu({ id, x, y });
            }}
          />
        ) : (
          groups.map((group) => (
            <section key={group.label} aria-label={group.label} className="flex flex-col gap-3">
              <h2 className="flex items-baseline gap-2 text-sm font-semibold">
                {group.label}
                <span className="text-xs font-normal text-muted-foreground">
                  {group.entries.length}
                </span>
              </h2>
              <div className="grid grid-cols-[repeat(auto-fill,minmax(210px,1fr))] gap-4">
                {group.entries.map((entry) => (
                  <Card
                    key={entry.id}
                    entry={entry}
                    group={group.label}
                    selecting={selecting}
                    selected={selected.has(entry.id)}
                    onToggle={toggle}
                    onOpen={edit}
                    onCopy={copy}
                    onPin={(id) => {
                      pin([id]);
                    }}
                    onRemove={(id) => {
                      remove([id]);
                    }}
                    onKey={onCardKey}
                    onMenu={(id, x, y) => {
                      setMenu({ id, x, y });
                    }}
                  />
                ))}
              </div>
            </section>
          ))
        )}
      </div>
    );
  }

  const bulk = [...selected];
  return (
    <div className="flex h-screen bg-background text-foreground">
      {filters === "sidebar" ? (
        <nav
          aria-label="Filters"
          className="flex w-[220px] shrink-0 flex-col gap-1 border-r border-border bg-card p-4"
        >
          <div className="mb-3 flex items-center gap-2 px-1 text-foreground">
            <LogoMark className="size-6" />
            <span className="font-[Outfit] text-lg font-semibold">LumenGrab</span>
          </div>
          <Button variant="accent" className="mb-3 w-full" onClick={newCapture}>
            <Plus aria-hidden /> New capture
          </Button>
          {FILTER_LIST.slice(0, 2).map(({ id, label }) => (
            <FilterButton
              key={id}
              label={label}
              count={counts[id]}
              active={filter === id}
              onClick={() => {
                setFilter(id);
              }}
            />
          ))}
          <span className="mt-4 mb-1 px-2.5 text-xs font-semibold tracking-wide text-muted-foreground uppercase">
            Source
          </span>
          {SOURCES.map(({ id, label }) => (
            <FilterButton
              key={id}
              label={label}
              count={counts[id]}
              active={filter === id}
              icon={SOURCE_ICONS[id]}
              onClick={() => {
                setFilter(id);
              }}
            />
          ))}
          <div className="flex-1" />
          <button
            type="button"
            onClick={() => {
              void platform.openSettings("history");
            }}
            className="rounded-md px-2.5 py-2 text-left text-sm text-muted-foreground outline-none hover:bg-accent focus-visible:ring-2 focus-visible:ring-ring"
          >
            History settings
          </button>
        </nav>
      ) : null}

      <div className="flex min-w-0 flex-1 flex-col">
        {toolbar}
        {chips}
        <main className="min-h-0 flex-1 overflow-auto" aria-label="Captures">
          {body}
        </main>
        {selecting ? (
          <footer className="flex shrink-0 items-center gap-2 border-t border-border bg-card px-6 py-3">
            <span className="mr-auto text-sm font-medium">{String(selected.size)} selected</span>
            <Button
              variant="outline"
              size="sm"
              disabled={bulk.length !== 1}
              title={bulk.length > 1 ? "Select one capture to copy it" : undefined}
              onClick={() => {
                if (bulk[0]) copy(bulk[0]);
              }}
            >
              <Copy aria-hidden /> Copy
            </Button>
            <Button
              variant="outline"
              size="sm"
              disabled={bulk.length === 0}
              onClick={() => {
                pin(bulk);
              }}
            >
              <Pin aria-hidden /> Pin
            </Button>
            <Button
              variant="outline"
              size="sm"
              disabled={bulk.length !== 1}
              title={bulk.length > 1 ? "Select one capture to save it" : undefined}
              onClick={() => {
                if (bulk[0]) saveCopy(bulk[0]);
              }}
            >
              Save…
            </Button>
            <Button
              variant="outline"
              size="sm"
              disabled={bulk.length === 0}
              onClick={() => {
                remove(bulk);
              }}
            >
              Remove from History
            </Button>
            <Button
              variant="destructive"
              size="sm"
              disabled={bulk.length === 0}
              onClick={() => {
                askToTrash(bulk);
              }}
            >
              <Trash2 aria-hidden /> Move to Trash
            </Button>
          </footer>
        ) : null}
      </div>

      {menu ? (
        <Menu
          label="Capture actions"
          at={menu}
          items={menuItems(menu.id)}
          onClose={() => {
            setMenu(null);
          }}
        />
      ) : null}
      {asking ? (
        <Modal
          label={`Move ${String(asking.length)} images to Trash?`}
          className="w-[440px]"
          onClose={() => {
            setAsking(null);
          }}
        >
          <h2 className="text-lg font-semibold">Move {asking.length} images to Trash?</h2>
          <p className="text-sm text-muted-foreground">
            They stay in your system Trash until you empty it. You can also undo right after.
          </p>
          <div className="flex justify-end gap-2">
            <Button
              variant="outline"
              onClick={() => {
                setAsking(null);
              }}
            >
              Cancel
            </Button>
            <Button
              variant="destructive"
              onClick={() => {
                trash(asking);
              }}
            >
              Move to Trash
            </Button>
          </div>
        </Modal>
      ) : null}
      {message ? (
        <div className="pointer-events-none fixed bottom-6 left-1/2 z-40 -translate-x-1/2">
          <ToastBar icon={message.tone === "error" ? TriangleAlert : Check} action={message.action}>
            {message.text}
          </ToastBar>
        </div>
      ) : null}
    </div>
  );
}

const FILTER_LIST: { id: HistoryFilter; label: string }[] = [
  { id: "all", label: "All" },
  { id: "pinned", label: "Pinned" },
  ...SOURCES.map((s) => ({ id: s.id, label: s.label })),
];

const HOTKEY_LABEL: Record<HotkeyInfo["id"], string> = {
  capture: "All-in-one capture",
  area: "Capture area",
  window: "Capture window",
  fullscreen: "Capture fullscreen",
  history: "Open history",
  pin: "Pin last capture",
  unlock: "Unlock pins",
};

function FilterButton({
  label,
  count,
  active,
  icon: Icon,
  onClick,
}: {
  label: string;
  count: number;
  active: boolean;
  icon?: typeof Monitor;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      aria-pressed={active}
      onClick={onClick}
      className={cn(
        "flex w-full items-center gap-2.5 rounded-md px-2.5 py-2 text-sm font-medium outline-none focus-visible:ring-2 focus-visible:ring-ring",
        active
          ? "bg-brand text-brand-foreground"
          : "text-muted-foreground hover:bg-accent hover:text-accent-foreground",
      )}
    >
      {Icon ? <Icon className="size-4 shrink-0" aria-hidden /> : null}
      <span className="flex-1 text-left">{label}</span>
      <span className="text-xs opacity-70">{count}</span>
    </button>
  );
}

function Thumb({ entry, className }: { entry: HistoryEntry; className?: string }) {
  if (entry.missing) {
    return (
      <div
        className={cn(
          "flex flex-col items-center justify-center gap-1 bg-muted text-muted-foreground",
          className,
        )}
      >
        <TriangleAlert className="size-5" aria-hidden />
        <span className="text-xs font-medium">File not found</span>
      </div>
    );
  }
  return (
    <img
      src={platform.historyThumbUrl(entry.id)}
      alt=""
      loading="lazy"
      draggable={false}
      className={cn("bg-muted object-cover", className)}
    />
  );
}

function Card({
  entry,
  group,
  selecting,
  selected,
  onToggle,
  onOpen,
  onCopy,
  onPin,
  onRemove,
  onKey,
  onMenu,
}: {
  entry: HistoryEntry;
  group: DayGroup["label"];
  selecting: boolean;
  selected: boolean;
  onToggle: (id: string) => void;
  onOpen: (id: string) => void;
  onCopy: (id: string) => void;
  onPin: (id: string) => void;
  onRemove: (id: string) => void;
  onKey: (e: React.KeyboardEvent, entry: HistoryEntry) => void;
  onMenu: (id: string, x: number, y: number) => void;
}) {
  const Source = SOURCE_ICONS[entry.source];
  return (
    <div
      role="group"
      aria-label={entry.name}
      data-testid="history-card"
      className={cn(
        "group relative flex flex-col overflow-hidden rounded-lg border bg-card",
        selected ? "border-2 border-primary" : "border-border",
      )}
      onKeyDown={(e) => {
        onKey(e, entry);
      }}
      onContextMenu={(e) => {
        e.preventDefault();
        onMenu(entry.id, e.clientX, e.clientY);
      }}
    >
      <button
        type="button"
        aria-label={selecting ? `Select ${entry.name}` : `Open ${entry.name}`}
        aria-pressed={selecting ? selected : undefined}
        onClick={() => {
          if (selecting) onToggle(entry.id);
          else if (!entry.missing) onOpen(entry.id);
        }}
        className="block aspect-[16/10] w-full overflow-hidden text-left outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-inset"
      >
        <Thumb entry={entry} className="size-full" />
      </button>
      {selecting ? (
        <span
          aria-hidden
          className={cn(
            "pointer-events-none absolute top-2 left-2 flex size-5 items-center justify-center rounded-full border-2",
            selected
              ? "border-primary bg-primary text-primary-foreground"
              : "border-white bg-black/30",
          )}
        >
          {selected ? <Check className="size-3" /> : null}
        </span>
      ) : null}
      {!selecting && entry.pinned ? (
        <span className="absolute top-2 right-2 rounded-full bg-brand p-1 text-brand-foreground">
          <Pin className="size-3" aria-label="Pinned" />
        </span>
      ) : null}
      {!selecting ? (
        <div className="absolute top-2 left-2 flex gap-1 opacity-0 transition-opacity group-focus-within:opacity-100 group-hover:opacity-100">
          {entry.missing ? (
            <HoverButton
              label="Remove"
              onClick={() => {
                onRemove(entry.id);
              }}
            >
              <Trash2 className="size-3.5" aria-hidden />
            </HoverButton>
          ) : (
            <>
              <HoverButton
                label="Copy image"
                onClick={() => {
                  onCopy(entry.id);
                }}
              >
                <Copy className="size-3.5" aria-hidden />
              </HoverButton>
              <HoverButton
                label="Edit"
                onClick={() => {
                  onOpen(entry.id);
                }}
              >
                <Pencil className="size-3.5" aria-hidden />
              </HoverButton>
              <HoverButton
                label="Pin"
                onClick={() => {
                  onPin(entry.id);
                }}
              >
                <Pin className="size-3.5" aria-hidden />
              </HoverButton>
              <HoverButton
                label="More"
                onClick={(e) => {
                  const box = e.currentTarget.getBoundingClientRect();
                  onMenu(entry.id, box.left, box.bottom + 4);
                }}
              >
                <MoreHorizontal className="size-3.5" aria-hidden />
              </HoverButton>
            </>
          )}
        </div>
      ) : null}
      <div className="flex items-start gap-2 px-3 py-2.5">
        <div className="flex min-w-0 flex-1 flex-col">
          <span className="truncate text-sm font-medium" title={entry.name}>
            {entry.name}
          </span>
          <span className="truncate text-xs text-muted-foreground">
            {entry.missing ? "Moved or deleted" : cardLine(entry, group)}
          </span>
        </div>
        <Source
          className="mt-0.5 size-3.5 shrink-0 text-muted-foreground"
          aria-label={sourceLabel(entry.source)}
        />
      </div>
    </div>
  );
}

function HoverButton({
  label,
  onClick,
  children,
}: {
  label: string;
  onClick: (e: React.MouseEvent<HTMLButtonElement>) => void;
  children: ReactNode;
}) {
  return (
    <button
      type="button"
      aria-label={label}
      title={label}
      onClick={onClick}
      className="rounded-md bg-black/60 p-1.5 text-white outline-none hover:bg-black/80 focus-visible:ring-2 focus-visible:ring-ring"
    >
      {children}
    </button>
  );
}

function ListView({
  groups,
  selecting,
  selected,
  onToggle,
  onOpen,
  onKey,
  onMenu,
}: {
  groups: DayGroup[];
  selecting: boolean;
  selected: ReadonlySet<string>;
  onToggle: (id: string) => void;
  onOpen: (id: string) => void;
  onKey: (e: React.KeyboardEvent, entry: HistoryEntry) => void;
  onMenu: (id: string, x: number, y: number) => void;
}) {
  return (
    <table className="w-full text-left text-sm" aria-label="Captures">
      <thead className="text-xs text-muted-foreground">
        <tr className="border-b border-border">
          <th className="py-2 pr-3 font-medium">Name</th>
          <th className="px-3 py-2 font-medium">Source</th>
          <th className="px-3 py-2 font-medium">Size</th>
          <th className="px-3 py-2 font-medium">Captured</th>
          <th className="px-3 py-2 text-right font-medium">File</th>
        </tr>
      </thead>
      <tbody>
        {groups.flatMap((group) =>
          group.entries.map((entry) => (
            <tr
              key={entry.id}
              data-testid="history-row"
              aria-selected={selecting ? selected.has(entry.id) : undefined}
              className={cn(
                "border-b border-border outline-none focus-within:bg-accent hover:bg-accent/60",
                selected.has(entry.id) && "bg-accent",
              )}
              onKeyDown={(e) => {
                onKey(e, entry);
              }}
              onContextMenu={(e) => {
                e.preventDefault();
                onMenu(entry.id, e.clientX, e.clientY);
              }}
            >
              <td className="py-2 pr-3">
                <button
                  type="button"
                  aria-label={selecting ? `Select ${entry.name}` : `Open ${entry.name}`}
                  onClick={() => {
                    if (selecting) onToggle(entry.id);
                    else if (!entry.missing) onOpen(entry.id);
                  }}
                  className="flex w-full items-center gap-3 text-left outline-none"
                >
                  <Thumb entry={entry} className="h-9 w-14 shrink-0 rounded" />
                  <span className="truncate font-medium">{entry.name}</span>
                </button>
              </td>
              <td className="px-3 py-2 text-muted-foreground">{sourceLabel(entry.source)}</td>
              <td className="px-3 py-2 text-muted-foreground">{size(entry)}</td>
              <td className="px-3 py-2 text-muted-foreground">{listWhen(entry, group.label)}</td>
              <td className="px-3 py-2 text-right text-muted-foreground">
                {entry.missing ? "Moved or deleted" : formatBytes(entry.bytes)}
              </td>
            </tr>
          )),
        )}
      </tbody>
    </table>
  );
}
