export const CATEGORY_LABELS = {
  new: "New",
  improved: "Improved",
  fixed: "Fixed",
  internal: "Under the hood",
};
const STATUSES = { done: "Done", building: "Building now", next: "Next up", planned: "Planned" };
const text = (value, name, limit = 4000) => {
  if (typeof value !== "string" || !value.trim() || value.length > limit)
    throw new Error(`Invalid ${name}`);
  return value.trim();
};
const date = (value) => {
  if (
    typeof value !== "string" ||
    !/^\d{4}-\d{2}-\d{2}(T\d{2}:\d{2}:\d{2}(\.\d{3})?Z)?$/.test(value) ||
    !Number.isFinite(Date.parse(value)) ||
    new Date(value).toISOString().slice(0, 10) !== value.slice(0, 10)
  )
    throw new Error("Invalid date");
  return value;
};
const unique = (rows, name) => {
  if (!Array.isArray(rows) || new Set(rows.map((row) => row.id)).size !== rows.length)
    throw new Error(`Duplicate ${name} IDs`);
};
const githubURL = (value) => {
  const url = new URL(value);
  if (url.origin !== "https://github.com" || !url.pathname.startsWith("/DasTvm/LumenGrab/"))
    throw new Error("Invalid source URL");
  return value;
};
export function validateRoadmap(input) {
  if (input?.schemaVersion !== 1 || !Array.isArray(input.milestones) || !input.milestones.length)
    throw new Error("Unsupported roadmap");
  unique(input.milestones, "milestone");
  input.milestones.forEach((milestone) => {
    if (!/^M\d+$/.test(milestone.id) || !STATUSES[milestone.status])
      throw new Error("Invalid milestone status");
    text(milestone.title, "milestone title");
    text(milestone.description, "milestone description");
    if (!Array.isArray(milestone.tasks) || !milestone.tasks.length)
      throw new Error("Milestone needs tasks");
    unique(milestone.tasks, "task");
    milestone.tasks.forEach((task) => {
      text(task.id, "task ID");
      text(task.title, "task title");
      if (typeof task.done !== "boolean")
        throw new Error("Task needs an explicit completion state");
    });
    if (
      milestone.status === "done" &&
      (!milestone.tasks.every((task) => task.done) || !milestone.finishedAt)
    )
      throw new Error("Done milestones need complete tasks and a completion date");
    if (milestone.finishedAt) date(milestone.finishedAt);
  });
  if (!Array.isArray(input.later)) throw new Error("Roadmap needs later ideas");
  unique(input.later, "idea");
  input.later.forEach((idea) => {
    text(idea.id, "idea ID");
    text(idea.title, "idea title");
    text(idea.icon, "idea icon");
  });
  if (input.firstRelease) {
    text(input.firstRelease.description, "first-release description");
    if (!Array.isArray(input.firstRelease.changes)) throw new Error("Invalid planned scope");
    input.firstRelease.changes.forEach((change) => {
      if (!CATEGORY_LABELS[change.category]) throw new Error("Invalid category");
      text(change.title, "planned change");
    });
  }
  return input;
}
export function classifyCommit(message) {
  const match = message.match(/^([a-z]+)(?:\([^)]+\))?!?:\s+([\s\S]+)/i);
  const type = match?.[1]?.toLowerCase();
  return {
    category:
      type === "feat"
        ? "new"
        : type === "fix"
          ? "fixed"
          : type === "perf"
            ? "improved"
            : "internal",
    title: match?.[2] || message,
  };
}
export function normalizeCommits(commits) {
  const seen = new Set();
  return commits
    .filter((commit) => {
      if (seen.has(commit.sha)) return false;
      seen.add(commit.sha);
      return true;
    })
    .map((commit) => {
      if (!/^[a-f0-9]{40}$/.test(commit.sha)) throw new Error("Invalid commit ID");
      const message = text(commit.commit.message.split("\n")[0], "commit message");
      return {
        id: commit.sha,
        date: date(commit.commit.committer.date),
        ...classifyCommit(message),
        url: githubURL(commit.html_url),
      };
    })
    .sort((a, b) => a.date.localeCompare(b.date) || a.id.localeCompare(b.id));
}
export function normalizeReleases(releases) {
  return releases
    .filter((release) => !release.draft && release.published_at)
    .map((release) => ({
      id: String(release.id),
      version: text(release.tag_name, "release version", 200),
      title: text(release.name || release.tag_name, "release title"),
      publishedAt: date(release.published_at),
      prerelease: !!release.prerelease,
      url: githubURL(release.html_url),
      body: release.body || "",
    }))
    .sort((a, b) => b.publishedAt.localeCompare(a.publishedAt));
}
export function validateFeed(feed) {
  if (feed?.schemaVersion !== 1 || feed.repository !== "DasTvm/LumenGrab")
    throw new Error("Unsupported feed");
  date(feed.generatedAt);
  validateRoadmap(feed.roadmap);
  unique(feed.changes, "change");
  unique(feed.releases, "release");
  if (!Array.isArray(feed.unreleasedIds)) throw new Error("Missing unreleased commit IDs");
  const ids = new Set(feed.changes.map((change) => change.id));
  if (feed.unreleasedIds.some((id) => !ids.has(id))) throw new Error("Unknown unreleased change");
  feed.changes.forEach((change) => {
    if (!/^[a-f0-9]{40}$/.test(change.id) || !CATEGORY_LABELS[change.category])
      throw new Error("Invalid change");
    date(change.date);
    text(change.title, "change title");
    githubURL(change.url);
  });
  feed.releases.forEach((release) => {
    text(release.id, "release ID");
    text(release.version, "release version");
    text(release.title, "release title");
    date(release.publishedAt);
    githubURL(release.url);
    if (
      typeof release.prerelease !== "boolean" ||
      typeof release.body !== "string" ||
      release.body.length > 200000
    )
      throw new Error("Invalid release");
  });
  return feed;
}
const shortDate = (value) =>
  new Intl.DateTimeFormat("en-US", { month: "short", day: "numeric", timeZone: "UTC" }).format(
    new Date(value),
  );
const cleanMarkdown = (value) =>
  value
    .replace(/!\[([^\]]*)\]\([^)]*\)/g, "$1")
    .replace(/\[([^\]]+)\]\([^)]*\)/g, "$1")
    .replace(/[*_`]/g, "")
    .trim();
function releaseChanges(release) {
  let category = "internal";
  const changes = [];
  for (const line of release.body.split("\n")) {
    const heading = line.match(/^#{1,6}\s+(.+)/);
    if (heading) {
      const key = heading[1].toLowerCase();
      category = /new|added|features/.test(key)
        ? "new"
        : /fixed|fixes/.test(key)
          ? "fixed"
          : /improved|changed|performance/.test(key)
            ? "improved"
            : "internal";
    } else if (line.trim() && !/^```/.test(line)) {
      changes.push({
        id: `${release.id}-${changes.length}`,
        category,
        title: cleanMarkdown(line.replace(/^\s*[-*+]\s+|^\s*\d+\.\s+/, "")),
        url: release.url,
      });
    }
  }
  return changes.length
    ? changes
    : [
        {
          id: `${release.id}-notes`,
          category: "internal",
          title: "Read the release notes on GitHub.",
          url: release.url,
        },
      ];
}
const groups = (changes) =>
  Object.entries(CATEGORY_LABELS)
    .map(([category, label]) => ({
      category,
      label,
      changes: changes.filter((change) => change.category === category),
    }))
    .filter((group) => group.changes.length);
const entry = (
  id,
  title,
  subtitle,
  badge,
  description,
  changes,
  kind = "prerelease",
  sourceURL = "",
  orderDate = "",
) => ({
  id,
  title,
  subtitle,
  badge,
  description,
  kind,
  frameLabel:
    kind === "planned"
      ? "PLANNED RELEASE"
      : kind === "release"
        ? "RELEASE FRAME"
        : "DEVELOPMENT FRAME",
  sourceURL,
  orderDate,
  changes,
  groups: groups(changes),
  groupsJson: JSON.stringify(groups(changes)),
});
export function buildProjectView(input) {
  const feed = validateFeed(input);
  const changes = [...feed.changes].sort((a, b) => a.date.localeCompare(b.date));
  const counts = Object.entries(CATEGORY_LABELS).map(([category, label]) => ({
    category,
    label,
    count: changes.filter((change) => change.category === category).length,
  }));
  const dayMap = new Map();
  for (const change of changes) {
    const day = change.date.slice(0, 10);
    if (!dayMap.has(day)) dayMap.set(day, []);
    dayMap.get(day).push(change);
  }
  const days = [...dayMap].map(([day, cells]) => ({ day, label: shortDate(day), cells }));
  const elapsedDays = changes.length
    ? Math.round(
        (Date.parse(changes.at(-1).date.slice(0, 10)) - Date.parse(changes[0].date.slice(0, 10))) /
          86400000,
      ) + 1
    : 0;
  const unreleased = new Set(feed.unreleasedIds);
  const entries = [
    ...feed.releases.map((release) =>
      entry(
        `release-${release.id}`,
        release.version,
        release.title,
        release.prerelease ? "Pre-release" : "Released",
        shortDate(release.publishedAt),
        releaseChanges(release),
        "release",
        release.url,
        release.publishedAt,
      ),
    ),
    ...days
      .slice()
      .reverse()
      .map((day) => {
        const pending = day.cells.filter((change) => unreleased.has(change.id));
        return pending.length
          ? entry(
              `day-${day.day}`,
              day.label,
              "Pre-release log",
              `${pending.length} ${pending.length === 1 ? "change" : "changes"}`,
              "Development updates. Not released.",
              [...pending].reverse(),
              "prerelease",
              "",
              pending.at(-1).date,
            )
          : null;
      })
      .filter(Boolean),
  ].sort((a, b) => Date.parse(b.orderDate) - Date.parse(a.orderDate));
  if (!feed.releases.some((release) => !release.prerelease) && feed.roadmap.firstRelease) {
    const planned = feed.roadmap.firstRelease;
    entries.unshift(
      entry(
        "next-release",
        "Next",
        "First public release",
        "In the works",
        planned.description,
        planned.changes.map((change, i) => ({ ...change, id: `planned-${i}`, url: "" })),
        "planned",
      ),
    );
  }
  const milestones = feed.roadmap.milestones.map((milestone) => {
    const done = milestone.tasks.filter((task) => task.done).length,
      total = milestone.tasks.length;
    const lit = Math.floor((done / total) * 24);
    const pixels = Array.from({ length: 24 }, (_, i) => ({ lit: i < lit ? "true" : "false" }));
    return {
      ...milestone,
      statusLabel: STATUSES[milestone.status],
      done,
      total,
      detail:
        milestone.status === "done"
          ? `Finished ${shortDate(milestone.finishedAt)}, ${milestone.finishedAt.slice(0, 4)}.`
          : done
            ? `${done} of ${total} pieces are in.`
            : `${STATUSES[milestone.status]}.`,
      pixels,
      tasksJson: JSON.stringify(milestone.tasks),
      pixelsJson: JSON.stringify(pixels),
    };
  });
  return {
    generatedAt: feed.generatedAt,
    updatedLabel:
      new Intl.DateTimeFormat("en-US", {
        dateStyle: "medium",
        timeStyle: "short",
        timeZone: "UTC",
      }).format(new Date(feed.generatedAt)) + " UTC",
    changeTotal: `${changes.length} ${changes.length === 1 ? "change" : "changes"}`,
    daysTotal: `in ${elapsedDays} ${elapsedDays === 1 ? "day" : "days"}.`,
    counts,
    days,
    entries,
    milestones,
    later: feed.roadmap.later,
    doneCount: milestones.filter((milestone) => milestone.status === "done").length,
    buildingCount: milestones.filter((milestone) => milestone.status === "building").length,
    plannedCount: milestones.filter((milestone) => ["next", "planned"].includes(milestone.status))
      .length,
    heroLead: feed.releases.some((release) => !release.prerelease)
      ? "Every release, every improvement. Follow what is new in LumenGrab, straight from the repository."
      : "LumenGrab hasn't shipped yet. Until the first release, this is the pre-release log, straight from the repository.",
  };
}
