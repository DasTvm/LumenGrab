# Website data

The website renders the Changelog and Roadmap from one validated public feed.
No app backend, account, private token in a browser, or second repository is required.

## Roadmap editing

Edit `docs/website-roadmap.json`. Status is explicitly `done`, `building`, `next`,
or `planned`. Mark each task's `done` boolean after verification. A completed
milestone needs all tasks complete and `finishedAt` in YYYY-MM-DD format.
Completion is never inferred from commit messages. Update task states and milestone
status in the same commit as the implemented or verified work. Outstanding native
and manual checks remain explicit incomplete tasks.

Run `node scripts/website/roadmap-markdown.mjs` after editing. It regenerates
`docs/ROADMAP.md`, so the machine-readable file and repository documentation agree.
CI validates the feed model and runs the generator with `--check` on every pull
request and main push. This detects inconsistent roadmap files; agents still need
to record actual implementation and verification progress in the JSON.

The October 11, 2026 reconciliation records M1's real multi-monitor/mixed-DPI
verification confirmed by the maintainer, M2's Quick Access Edit integration,
and M3's implemented document format. M4's core editor tasks are implemented and
covered by automated tests; the native/manual acceptance checklist is still
tracked separately before closing M4. See `docs/CAPTURE_TEST_CHECKLIST.md` section 6e.

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
node scripts/website/roadmap-markdown.mjs --check
node scripts/website/sync-feed.mjs /tmp/project-feed.json
```
