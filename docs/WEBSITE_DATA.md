# Website data

The website renders the Changelog and Roadmap from one validated public feed.
No app backend, account, private token in a browser, or second repository is required.

## Roadmap editing

Edit `docs/website-roadmap.json`. Status is explicitly `done`, `building`, `next`,
or `planned`. Mark each task's `done` boolean after verification. A completed
milestone needs all tasks complete and `finishedAt` in YYYY-MM-DD format.
Completion is never inferred from commit messages. The initial task states come
from the approved Pencil website design; they are not an automatic audit of code.

Run `node scripts/website/roadmap-markdown.mjs` after editing. It regenerates
`docs/ROADMAP.md`, so the machine-readable file and repository documentation agree.

## Changelog editing

Conventional commits become pre-release entries: `feat` is New, `fix` is Fixed,
`perf` is Improved, and other changes are Under the hood. Published release notes
use the sections `## New`, `## Improved`, `## Fixed`, and `## Under the hood`.
Other Markdown content is displayed as plain release-note text. Raw HTML never
executes. Draft releases are excluded. Stable release tags determine which commits
remain unreleased, rather than comparing publication timestamps.

## Synchronization

`website-feed.yml` runs on main pushes, public release changes, manual runs, and an
hourly reconciliation. Generation and validation finish before publishing anything.
If GitHub or validation fails, the existing snapshot stays intact. The output is
`project-feed.json` on the `website-data` branch of this same repository.

The website polls this public snapshot at page load, on return to a visible tab,
and every five minutes while visible. GitHub's raw-file cache and workflow runtime
mean this is eventual synchronization, not immediate real-time delivery. The
bundled build snapshot remains the no-JavaScript and offline fallback.

Never put private information or credentials in roadmap text, commits, or this feed.

## Commands

```sh
node --test scripts/website/project-data-model.test.mjs
node scripts/website/roadmap-markdown.mjs
node scripts/website/sync-feed.mjs /tmp/project-feed.json
```
