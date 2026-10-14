/** The words and numbers of the update screens, as pure functions (tested in Node). */

export interface NoteGroup {
  title: "New" | "Improved" | "Fixed";
  items: string[];
}

const GROUPS: Record<string, NoteGroup["title"]> = {
  new: "New",
  added: "New",
  improved: "Improved",
  changed: "Improved",
  fixed: "Fixed",
  fix: "Fixed",
};

/**
 * The release notes (Markdown of the GitHub release) sorted into New, Improved and Fixed. A heading
 * (`### New`, `**Fixed**`, `New:`) starts a group, a `-` or `*` line is an item. Anything else is
 * ignored, so a release written freely just shows no list (the page still links to the release).
 */
export function parseReleaseNotes(markdown: string | null): NoteGroup[] {
  const groups: NoteGroup[] = [];
  let current: NoteGroup | null = null;
  for (const raw of (markdown ?? "").split(/\r?\n/)) {
    const line = raw.trim();
    const heading = /^(?:#{1,6}\s*|\*\*)?([A-Za-z]+)(?:\*\*)?:?$/.exec(line);
    const title = heading ? GROUPS[(heading[1] ?? "").toLowerCase()] : undefined;
    if (title) {
      current = groups.find((g) => g.title === title) ?? { title, items: [] };
      if (!groups.includes(current)) groups.push(current);
      continue;
    }
    const item = /^[-*]\s+(.+)$/.exec(line);
    if (item?.[1] && current && current.items.length < 12)
      current.items.push(item[1].replace(/\*\*/g, ""));
  }
  return groups.filter((g) => g.items.length > 0);
}

const MB = 1024 * 1024;

export function megabytes(bytes: number): string {
  return String(Math.max(0, Math.round(bytes / MB)));
}

/** "24 of 38 MB", or "24 MB" while the total is not known. */
export function sizeText(downloaded: number, total: number | null): string {
  return total
    ? `${megabytes(downloaded)} of ${megabytes(total)} MB`
    : `${megabytes(downloaded)} MB`;
}

/** "about 10 seconds left", from how fast the download went so far; empty while it is too early to say. */
export function remainingText(
  downloaded: number,
  total: number | null,
  startedAt: number,
  now: number,
): string {
  const elapsed = (now - startedAt) / 1000;
  if (!total || downloaded <= 0 || elapsed < 1.5 || downloaded >= total) return "";
  const seconds = Math.round(((total - downloaded) / downloaded) * elapsed);
  if (seconds < 5) return "a few seconds left";
  if (seconds < 90) return `about ${String(Math.ceil(seconds / 5) * 5)} seconds left`;
  return `about ${String(Math.round(seconds / 60))} minutes left`;
}

const two = (n: number) => String(n).padStart(2, "0");
const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

/** "today, 09:41", "yesterday, 18:02", "Oct 12, 09:41" (local time). */
export function lastCheckedText(iso: string | null, now: Date = new Date()): string | null {
  if (!iso) return null;
  const at = new Date(iso);
  if (Number.isNaN(at.getTime())) return null;
  const time = `${two(at.getHours())}:${two(at.getMinutes())}`;
  const day = (d: Date) => new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();
  const days = Math.round((day(now) - day(at)) / 86_400_000);
  if (days === 0) return `today, ${time}`;
  if (days === 1) return `yesterday, ${time}`;
  return `${MONTHS[at.getMonth()] ?? ""} ${String(at.getDate())}, ${time}`;
}

/** "Oct 12, 2026" from `YYYY-MM-DD`. */
export function releaseDateText(date: string | null): string | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(date ?? "");
  if (!m) return null;
  return `${MONTHS[Number(m[2]) - 1] ?? ""} ${String(Number(m[3]))}, ${m[1] ?? ""}`;
}

/** The page of a release on GitHub (the "See what's new" link). */
export function releaseUrl(version: string): string {
  return `https://github.com/DasTvm/LumenGrab/releases/tag/v${encodeURIComponent(version)}`;
}

/** The title and the text of the error state, by what went wrong (design: Update failed ...). */
export function failureText(reason: "network" | "signature" | "disk" | "other"): {
  title: string;
  body: string;
} {
  switch (reason) {
    case "network":
      return {
        title: "Could not check for updates",
        body: "LumenGrab couldn't reach the update server. Check your internet connection and try again.",
      };
    case "signature":
      return {
        title: "Update failed: security check",
        body: "The update did not pass its signature check, so it was not installed. Your current version is untouched.",
      };
    case "disk":
      return {
        title: "Update failed: not enough space",
        body: "There is not enough free disk space for the update. Free some up and try again.",
      };
    case "other":
      return {
        title: "The update did not work",
        body: "Something went wrong while updating. Your current version is untouched. Try again in a moment.",
      };
  }
}
