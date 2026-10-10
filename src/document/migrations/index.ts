import { DocumentError } from "../errors";
import { FORMAT_VERSION } from "../limits";

/**
 * `project.json` migrations (docs/FORMAT.md section 5). `MIGRATIONS[n]` upgrades a project from
 * version `n` to `n + 1`. They are pure, go forward only, and run in memory on open; the file on disk
 * is only rewritten when the user saves.
 *
 * Version 1 is the first version, so there is nothing to migrate yet. When the schema changes:
 * bump `FORMAT_VERSION`, add `MIGRATIONS[oldVersion]`, add a golden fixture `fixtures/lumengrab/v<new>-*`
 * and update docs/FORMAT.md in the same commit.
 */
export type Migration = (project: Record<string, unknown>) => Record<string, unknown>;

export const MIGRATIONS: Readonly<Record<number, Migration>> = {};

/**
 * Upgrades a raw project (version `fromVersion`) step by step to `target`. A project that is already
 * at or beyond `target` is returned unchanged (a newer file that is still readable is validated, not
 * downgraded).
 */
export function migrateToLatest(
  project: Record<string, unknown>,
  fromVersion: number,
  registry: Readonly<Record<number, Migration>> = MIGRATIONS,
  target: number = FORMAT_VERSION,
): Record<string, unknown> {
  let current = project;
  for (let version = fromVersion; version < target; version += 1) {
    const step = registry[version];
    if (!step) {
      throw new DocumentError(
        "invalid-field",
        `project.json: no migration from version ${String(version)} to ${String(version + 1)}`,
      );
    }
    current = { ...step(current), version: version + 1 };
  }
  return current;
}
