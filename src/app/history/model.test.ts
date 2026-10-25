import { describe, expect, it } from "vitest";
import type { HistoryEntry } from "@/platform";
import { cardLine, countFilters, filterEntries, formatDay, groupByDay, listWhen } from "./model";

const NOW = new Date(2026, 9, 25, 15, 0).getTime();
const at = (d: number, h: number, m = 0) => new Date(2026, 9, d, h, m).getTime();

function entry(id: string, capturedAt: number, patch: Partial<HistoryEntry> = {}): HistoryEntry {
  return {
    id,
    name: `${id}.png`,
    capturedAt,
    width: 1920,
    height: 1080,
    bytes: 1,
    source: "area",
    missing: false,
    pinned: false,
    ...patch,
  };
}

const ENTRIES = [
  entry("login", at(20, 9), { source: "allinone" }),
  entry("invoice", at(25, 10), { pinned: true }),
  entry("dashboard", at(24, 18, 20), { source: "fullscreen", width: 3024, height: 1964 }),
  entry("checkout", at(25, 11, 47), { source: "window" }),
];

describe("groupByDay", () => {
  it("sorts newest first into Today, Yesterday and Earlier and leaves empty groups out", () => {
    const groups = groupByDay(ENTRIES, NOW);
    expect(groups.map((g) => [g.label, g.entries.map((e) => e.id)])).toEqual([
      ["Today", ["checkout", "invoice"]],
      ["Yesterday", ["dashboard"]],
      ["Earlier", ["login"]],
    ]);
    expect(groupByDay([ENTRIES[1] as HistoryEntry], NOW).map((g) => g.label)).toEqual(["Today"]);
  });

  it("counts yesterday from midnight, not from 24 hours ago", () => {
    const lateLastNight = entry("late", new Date(2026, 9, 24, 23, 59).getTime());
    expect(groupByDay([lateLastNight], new Date(2026, 9, 25, 0, 5).getTime())[0]?.label).toBe(
      "Yesterday",
    );
  });
});

describe("filters", () => {
  it("counts every way of capturing and the pinned ones", () => {
    expect(countFilters(ENTRIES)).toEqual({
      all: 4,
      pinned: 1,
      area: 1,
      window: 1,
      fullscreen: 1,
      allinone: 1,
    });
  });

  it("filters by source and by pinned", () => {
    expect(filterEntries(ENTRIES, "window", "").map((e) => e.id)).toEqual(["checkout"]);
    expect(filterEntries(ENTRIES, "pinned", "").map((e) => e.id)).toEqual(["invoice"]);
    expect(filterEntries(ENTRIES, "all", "")).toHaveLength(4);
  });

  it("searches the name, the source and the size, every word must match", () => {
    expect(filterEntries(ENTRIES, "all", "INVOICE").map((e) => e.id)).toEqual(["invoice"]);
    expect(filterEntries(ENTRIES, "all", "fullscreen 3024").map((e) => e.id)).toEqual([
      "dashboard",
    ]);
    expect(filterEntries(ENTRIES, "all", "invoice window")).toEqual([]);
    expect(filterEntries(ENTRIES, "pinned", "login")).toEqual([]);
  });
});

describe("the lines under a card", () => {
  it("shows the clock for today and the date for older captures", () => {
    const [today, , , older] = [ENTRIES[3], ENTRIES[1], ENTRIES[2], ENTRIES[0]] as HistoryEntry[];
    expect(cardLine(today as HistoryEntry, "Today", NOW)).toBe("11:47 · 1920 × 1080");
    expect(cardLine(older as HistoryEntry, "Earlier", NOW)).toBe("Oct 20 · 1920 × 1080");
    expect(listWhen(today as HistoryEntry, "Today", NOW)).toBe("Today, 11:47");
    expect(listWhen(older as HistoryEntry, "Earlier", NOW)).toBe("Oct 20");
  });

  it("adds the year to dates of other years", () => {
    expect(formatDay(new Date(2025, 11, 31).getTime(), NOW)).toBe("Dec 31, 2025");
  });
});
