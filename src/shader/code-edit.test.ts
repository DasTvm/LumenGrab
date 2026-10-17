import { describe, expect, it } from "vitest";
import { addSetting, moveSetting, removeSetting, uniqueName, updateSetting } from "./code-edit";
import { parsePragmas } from "./custom";
import { EXAMPLES } from "./custom";

const code = EXAMPLES[0]?.code ?? "";
const names = (c: string) => parsePragmas(c).params.map((p) => p.spec.id);

describe("the settings builder edits the code", () => {
  it("rewrites a setting's line and keeps its uniform in step when the type changes", () => {
    const spec = parsePragmas(code).params[0]?.spec;
    if (!spec) throw new Error("spec");
    const next = updateSetting(code, "speed", {
      ...spec,
      type: "int",
      min: 0,
      max: 8,
      default: 2,
      step: 1,
      decimals: 0,
    });
    expect(parsePragmas(next).params[0]?.spec).toMatchObject({
      id: "speed",
      type: "int",
      default: 2,
      max: 8,
    });
    expect(next).toContain("uniform float speed;");
    const asSwitch = updateSetting(code, "speed", {
      id: "speed",
      label: "Speed",
      group: "Settings",
      type: "bool",
      default: true,
    });
    expect(asSwitch).toContain("uniform bool speed;");
    expect(asSwitch).not.toContain("uniform float speed;");
    expect(updateSetting(code, "nothing", spec)).toBe(code);
  });

  it("adds a setting with its line and its uniform, and a name that is free", () => {
    expect(uniqueName(code, "speed")).toBe("speed2");
    expect(uniqueName(code)).toBe("setting");
    const next = addSetting(code, {
      id: "glow",
      label: "Glow",
      group: "Settings",
      type: "number",
      min: 0,
      max: 1,
      step: 0.01,
      default: 0.5,
      decimals: 2,
    });
    expect(names(next)).toEqual([...names(code), "glow"]);
    expect(next).toContain("uniform float glow;");
    const lines = next.split("\n");
    expect(lines.findIndex((l) => l.includes("uniform float glow;"))).toBeGreaterThan(
      lines.findIndex((l) => l.includes("uniform float scale;")),
    );
    // The error lines of the rest of the code move by exactly two.
    expect(lines.length).toBe(code.split("\n").length + 2);
  });

  it("adds a first setting to code that has none", () => {
    const bare = "precision mediump float;\nvoid main() {\n  gl_FragColor = vec4(1.0);\n}\n";
    const next = addSetting(bare, {
      id: "a",
      label: "A",
      group: "Settings",
      type: "bool",
      default: true,
    });
    expect(names(next)).toEqual(["a"]);
    expect(next.split("\n")[0]).toMatch(/@param bool a/);
    expect(next).toContain("uniform bool a;");
  });

  it("removes a setting with its uniform and leaves the rest alone", () => {
    const next = removeSetting(code, "soft");
    expect(names(next)).toEqual(["speed", "scale"]);
    expect(next).not.toContain("uniform bool soft;");
    expect(next).toContain("uniform float speed;");
  });

  it("moves a setting among the others", () => {
    expect(names(moveSetting(code, "soft", 0))).toEqual(["soft", "speed", "scale"]);
    expect(names(moveSetting(code, "speed", 2))).toEqual(["scale", "soft", "speed"]);
    expect(moveSetting(code, "speed", 9)).toBe(code);
  });
});
