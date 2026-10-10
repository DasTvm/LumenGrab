import { readFile, writeFile, mkdir } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import {
  normalizeCommits,
  normalizeReleases,
  validateRoadmap,
  validateFeed,
  buildProjectView,
} from "./project-data-model.mjs";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const output = resolve(process.argv[2] || "project-feed.json");
const token = process.env.GITHUB_TOKEN;
const repo = "DasTvm/LumenGrab";
async function request(path) {
  const response = await fetch(`https://api.github.com/repos/${repo}/${path}`, {
    headers: {
      Accept: "application/vnd.github+json",
      "X-GitHub-Api-Version": "2022-11-28",
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    signal: AbortSignal.timeout(30000),
  });
  if (!response.ok) throw new Error(`GitHub request failed (${response.status})`);
  return response;
}
async function pages(path, key) {
  const rows = [];
  for (let page = 1; page <= 100; page++) {
    const response = await request(
      `${path}${path.includes("?") ? "&" : "?"}per_page=100&page=${page}`,
    );
    const data = await response.json();
    const list = key ? data[key] : data;
    if (!Array.isArray(list)) throw new Error("GitHub returned an unexpected list");
    rows.push(...list);
    if (!response.headers.get("link")?.includes('rel="next"')) return rows;
  }
  throw new Error("Feed exceeded the pagination limit; refusing to truncate history");
}
const roadmap = validateRoadmap(
  JSON.parse(await readFile(resolve(root, "docs/website-roadmap.json"), "utf8")),
);
const [commits, rawReleases] = await Promise.all([pages("commits?sha=main"), pages("releases")]);
const changes = normalizeCommits(commits),
  releases = normalizeReleases(rawReleases);
const latest = releases.find((release) => !release.prerelease);
const unreleasedIds = latest
  ? (await pages(`compare/${encodeURIComponent(latest.version)}...main`, "commits")).map(
      (commit) => commit.sha,
    )
  : changes.map((change) => change.id);
const feed = validateFeed({
  schemaVersion: 1,
  repository: repo,
  generatedAt: new Date().toISOString(),
  changes,
  releases,
  unreleasedIds,
  roadmap,
});
buildProjectView(feed);
await mkdir(dirname(output), { recursive: true });
await writeFile(output, JSON.stringify(feed, null, 2) + "\n");
console.log(
  `Validated ${changes.length} changes, ${releases.length} releases and ${roadmap.milestones.length} milestones.`,
);
