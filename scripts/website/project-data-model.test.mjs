import { test } from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import {
  validateFeed,
  validateRoadmap,
  normalizeCommits,
  normalizeReleases,
  buildProjectView,
} from "./project-data-model.mjs";

const roadmap = JSON.parse(
  await readFile(new URL("../../docs/website-roadmap.json", import.meta.url), "utf8"),
);
const commit = (number, message, date = "2026-10-10T18:00:00Z") => ({
  sha: number.toString(16).padStart(40, "0"),
  html_url: `https://github.com/DasTvm/LumenGrab/commit/${number.toString(16).padStart(40, "0")}`,
  commit: { message, committer: { date } },
});
const changes = normalizeCommits([
  commit(1, "feat(capture): area capture", "2026-10-06T12:00:00Z"),
  commit(2, "fix: drag-out"),
  commit(3, "perf: faster overlay"),
  commit(4, "docs: permission guide"),
]);
const fixture = () => ({
  schemaVersion: 1,
  repository: "DasTvm/LumenGrab",
  generatedAt: "2026-10-10T19:00:00Z",
  roadmap: structuredClone(roadmap),
  changes: structuredClone(changes),
  releases: [],
  unreleasedIds: changes.map((change) => change.id),
});

test("one shared model produces category totals, day clusters and daily filtered entries", () => {
  const view = buildProjectView(fixture());
  assert.deepEqual(
    view.counts.map((group) => group.count),
    [1, 1, 1, 1],
  );
  assert.equal(view.changeTotal, "4 changes");
  assert.equal(view.daysTotal, "in 5 days.");
  assert.equal(
    view.days.reduce((sum, day) => sum + day.cells.length, 0),
    4,
  );
  assert.equal(
    view.entries
      .filter((entry) => entry.kind === "prerelease")
      .reduce((sum, entry) => sum + entry.changes.length, 0),
    4,
  );
});
test("roadmap progress is based on explicit checked tasks, not commits", () => {
  const view = buildProjectView(fixture());
  assert.equal(view.milestones[1].done, 4);
  assert.equal(view.milestones[1].total, 5);
  assert.equal(
    JSON.parse(view.milestones[1].pixelsJson).filter((cell) => cell.lit === "true").length,
    19,
  );
  assert.equal(view.doneCount, 1);
  assert.equal(view.buildingCount, 2);
  const invalid = structuredClone(roadmap);
  invalid.milestones[1].status = "done";
  assert.throws(() => validateRoadmap(invalid));
});
test("rejects invalid categories, duplicate IDs, foreign links, impossible dates and incomplete feeds", () => {
  for (const mutate of [
    (feed) => {
      feed.changes[0].category = "unknown";
    },
    (feed) => {
      feed.changes.push(feed.changes[0]);
    },
    (feed) => {
      feed.changes[0].url = "https://evil.example/";
    },
    (feed) => {
      feed.generatedAt = "2026-02-30";
    },
    (feed) => {
      feed.unreleasedIds.push("missing");
    },
    (feed) => {
      feed.roadmap.milestones[0].tasks[0].done = "yes";
    },
  ]) {
    const feed = fixture();
    mutate(feed);
    assert.throws(() => validateFeed(feed));
  }
});
test("draft releases stay private and unreleased commits use tag comparison IDs", () => {
  const release = {
    id: 1,
    tag_name: "v1.0.0",
    name: "First release",
    published_at: "2026-10-10T18:30:00Z",
    html_url: "https://github.com/DasTvm/LumenGrab/releases/tag/v1.0.0",
    body: "## New\n- Area capture\n## Fixed\n- Drag-out",
    draft: false,
    prerelease: false,
  };
  const feed = fixture();
  feed.releases = normalizeReleases([release, { ...release, id: 2, draft: true }]);
  feed.unreleasedIds = [changes[3].id];
  const view = buildProjectView(feed);
  assert.equal(feed.releases.length, 1);
  assert.equal(
    view.entries.some((entry) => entry.kind === "planned"),
    false,
  );
  assert.deepEqual(
    JSON.parse(view.entries[0].groupsJson).map((group) => group.category),
    ["new", "fixed"],
  );
  assert.equal(
    view.entries.filter((entry) => entry.kind === "prerelease").flatMap((entry) => entry.changes)
      .length,
    1,
  );
});
test("plain release text cannot introduce executable HTML into rendered markup", () => {
  const feed = fixture();
  feed.releases = [
    {
      id: "1",
      version: "v1",
      title: "Release",
      publishedAt: "2026-10-10T18:00:00Z",
      prerelease: false,
      url: "https://github.com/DasTvm/LumenGrab/releases/tag/v1",
      body: "## New\n- <img src=x onerror=alert(1)>",
    },
  ];
  assert.equal(
    JSON.parse(buildProjectView(feed).entries[0].groupsJson)[0].changes[0].title,
    "<img src=x onerror=alert(1)>",
  );
});
