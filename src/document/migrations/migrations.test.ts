import { describe, expect, it } from "vitest";
import { DocumentError } from "../errors";
import { MIGRATIONS, migrateToLatest, type Migration } from "./index";

describe("migrations scaffold", () => {
  it("upgrades v1, v2 and v3 projects without changing them (v2 added groups, v3 presentation features, v4 shader backgrounds)", () => {
    expect(Object.keys(MIGRATIONS)).toEqual(["1", "2", "3"]);
    const project = { version: 1, layers: [{ id: "a", type: "rect" }], future: { keep: true } };
    expect(migrateToLatest(project, 1)).toEqual({ ...project, version: 4 });
    expect(migrateToLatest({ ...project, version: 2 }, 2)).toEqual({ ...project, version: 4 });
    expect(migrateToLatest({ ...project, version: 3 }, 3)).toEqual({ ...project, version: 4 });
    expect(migrateToLatest({ version: 4, layers: [] }, 4)).toEqual({ version: 4, layers: [] });
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
