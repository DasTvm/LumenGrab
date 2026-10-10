import { describe, expect, it } from "vitest";
import { DocumentError } from "../errors";
import { MIGRATIONS, migrateToLatest, type Migration } from "./index";

describe("migrations scaffold", () => {
  it("has nothing to do for version 1, the first version", () => {
    expect(Object.keys(MIGRATIONS)).toEqual([]);
    const project = { version: 1, layers: [] };
    expect(migrateToLatest(project, 1)).toBe(project);
  });

  it("runs the steps in order and stamps the new version after each", () => {
    const registry: Record<number, Migration> = {
      1: (p) => ({ ...p, trail: [...((p["trail"] as string[] | undefined) ?? []), "1->2"] }),
      2: (p) => ({ ...p, trail: [...((p["trail"] as string[] | undefined) ?? []), "2->3"] }),
    };
    expect(migrateToLatest({ version: 1 }, 1, registry, 3)).toEqual({
      version: 3,
      trail: ["1->2", "2->3"],
    });
    expect(migrateToLatest({ version: 2 }, 2, registry, 3)).toEqual({
      version: 3,
      trail: ["2->3"],
    });
  });

  it("does not downgrade a project that is already at or beyond the target", () => {
    const project = { version: 5, extra: true };
    expect(migrateToLatest(project, 5, {}, 3)).toBe(project);
  });

  it("says so when a step is missing instead of guessing", () => {
    expect(() => migrateToLatest({ version: 1 }, 1, { 2: (p) => p }, 3)).toThrow(DocumentError);
  });

  it("does not change the input", () => {
    const input = { version: 1, a: 1 };
    migrateToLatest(input, 1, { 1: (p) => ({ ...p, a: 2 }) }, 2);
    expect(input).toEqual({ version: 1, a: 1 });
  });
});
