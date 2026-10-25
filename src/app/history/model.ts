import type { HistoryEntry, HistorySource } from "@/platform";

/** What the sidebar or the chips filter by: everything, what is pinned, or one way of capturing. */
export type HistoryFilter = "all" | "pinned" | HistorySource;

export const SOURCES: { id: HistorySource; label: string }[] = [
  { id: "area", label: "Area" },
  { id: "window", label: "Window" },
  { id: "fullscreen", label: "Fullscreen" },
  { id: "allinone", label: "All-in-one" },
];

export function sourceLabel(source: HistorySource): string {
  return SOURCES.find((s) => s.id === source)?.label ?? source;
}

/** How many captures each filter would show (the numbers next to the filters). */
export function countFilters(entries: readonly HistoryEntry[]): Record<HistoryFilter, number> {
  const counts: Record<HistoryFilter, number> = {
    all: entries.length,
    pinned: 0,
    area: 0,
    window: 0,
    fullscreen: 0,
    allinone: 0,
  };
  for (const e of entries) {
    if (e.pinned) counts.pinned += 1;
    counts[e.source] += 1;
  }
  return counts;
}

/** The captures a filter and a search word leave. The search looks at the name, the way it was captured and the size. */
export function filterEntries(
  entries: readonly HistoryEntry[],
  filter: HistoryFilter,
  query: string,
): HistoryEntry[] {
  const words = query.toLowerCase().split(/\s+/).filter(Boolean);
  return entries.filter((e) => {
    if (filter === "pinned" ? !e.pinned : filter !== "all" && e.source !== filter) return false;
    if (words.length === 0) return true;
    const haystack =
      `${e.name} ${sourceLabel(e.source)} ${String(e.width)}x${String(e.height)}`.toLowerCase();
    return words.every((w) => haystack.includes(w));
  });
}

export interface DayGroup {
  label: "Today" | "Yesterday" | "Earlier";
  entries: HistoryEntry[];
}

function startOfDay(ms: number): number {
  const d = new Date(ms);
  d.setHours(0, 0, 0, 0);
  return d.getTime();
}

/** Newest first, in the groups the window shows. Empty groups are left out. */
export function groupByDay(entries: readonly HistoryEntry[], now = Date.now()): DayGroup[] {
  const today = startOfDay(now);
  const yesterday = startOfDay(today - 1);
  const groups: DayGroup[] = [
    { label: "Today", entries: [] },
    { label: "Yesterday", entries: [] },
    { label: "Earlier", entries: [] },
  ];
  for (const e of [...entries].sort((a, b) => b.capturedAt - a.capturedAt)) {
    const day = startOfDay(e.capturedAt);
    (day >= today ? groups[0] : day >= yesterday ? groups[1] : groups[2])?.entries.push(e);
  }
  return groups.filter((g) => g.entries.length > 0);
}

const pad = (n: number) => String(n).padStart(2, "0");

/** `14:02`. */
export function formatClock(ms: number): string {
  const d = new Date(ms);
  return `${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

/** `Oct 21` (with the year when it is not this year). */
export function formatDay(ms: number, now = Date.now()): string {
  const d = new Date(ms);
  const base = `${MONTHS[d.getMonth()] ?? ""} ${String(d.getDate())}`;
  return d.getFullYear() === new Date(now).getFullYear()
    ? base
    : `${base}, ${String(d.getFullYear())}`;
}

/** The line under a card: `14:02 · 1920 × 1080`, or `Oct 21 · …` for older captures. */
export function cardLine(e: HistoryEntry, group: DayGroup["label"], now = Date.now()): string {
  const when = group === "Earlier" ? formatDay(e.capturedAt, now) : formatClock(e.capturedAt);
  return `${when} · ${size(e)}`;
}

/** The "When" column of the list: `Today, 14:02`, `Yesterday, 18:20`, `Oct 21`. */
export function listWhen(e: HistoryEntry, group: DayGroup["label"], now = Date.now()): string {
  return group === "Earlier"
    ? formatDay(e.capturedAt, now)
    : `${group}, ${formatClock(e.capturedAt)}`;
}

export function size(e: Pick<HistoryEntry, "width" | "height">): string {
  return `${String(e.width)} × ${String(e.height)}`;
}
