import { describe, expect, it } from "vitest";
import {
  failureText,
  lastCheckedText,
  parseReleaseNotes,
  releaseDateText,
  remainingText,
  releaseUrl,
  sizeText,
} from "./model";

describe("release notes", () => {
  it("sorts bullets into New, Improved and Fixed by their headings", () => {
    const notes = [
      "### New",
      "- Presentation mode",
      "* Layers panel",
      "**Improved**",
      "- Faster overlay",
      "Fixed:",
      "- Quick Access closes **no more** while dragging",
      "Some free text that is ignored",
    ].join("\n");
    expect(parseReleaseNotes(notes)).toEqual([
      { title: "New", items: ["Presentation mode", "Layers panel"] },
      { title: "Improved", items: ["Faster overlay"] },
      { title: "Fixed", items: ["Quick Access closes no more while dragging"] },
    ]);
  });

  it("gives nothing for notes without groups, null, or empty groups", () => {
    expect(parseReleaseNotes(null)).toEqual([]);
    expect(
      parseReleaseNotes("Just a story about this release.\n- a bullet without a heading"),
    ).toEqual([]);
    expect(parseReleaseNotes("## New\n## Fixed\n- one")).toEqual([
      { title: "Fixed", items: ["one"] },
    ]);
  });
});

describe("numbers and dates", () => {
  it("writes the download in megabytes and the time left from the speed so far", () => {
    const MB = 1024 * 1024;
    expect(sizeText(24 * MB, 38 * MB)).toBe("24 of 38 MB");
    expect(sizeText(5 * MB, null)).toBe("5 MB");
    expect(remainingText(10 * MB, 40 * MB, 0, 1000)).toBe(""); // too early
    expect(remainingText(10 * MB, 40 * MB, 0, 3000)).toBe("about 10 seconds left"); // 30 MB left at 3.3 MB/s = 9 s
    expect(remainingText(39 * MB, 40 * MB, 0, 10_000)).toBe("a few seconds left");
    expect(remainingText(1 * MB, 400 * MB, 0, 10_000)).toBe("about 67 minutes left");
    expect(remainingText(40 * MB, 40 * MB, 0, 10_000)).toBe("");
  });

  it("says when the last check was, in local time", () => {
    const now = new Date(2026, 9, 14, 12, 0, 0);
    expect(lastCheckedText(new Date(2026, 9, 14, 9, 41).toISOString(), now)).toBe("today, 09:41");
    expect(lastCheckedText(new Date(2026, 9, 13, 18, 2).toISOString(), now)).toBe(
      "yesterday, 18:02",
    );
    expect(lastCheckedText(new Date(2026, 9, 1, 8, 5).toISOString(), now)).toBe("Oct 1, 08:05");
    expect(lastCheckedText(null, now)).toBeNull();
    expect(lastCheckedText("nonsense", now)).toBeNull();
    expect(releaseDateText("2026-10-12")).toBe("Oct 12, 2026");
    expect(releaseDateText("12.10.2026")).toBeNull();
  });

  it("links the release page and words each failure", () => {
    expect(releaseUrl("0.5.0")).toBe("https://github.com/DasTvm/LumenGrab/releases/tag/v0.5.0");
    expect(failureText("network").title).toBe("Could not check for updates");
    expect(failureText("signature").body).toContain("signature");
    expect(failureText("disk").title).toContain("space");
    expect(failureText("other").title).toBeTruthy();
  });
});
