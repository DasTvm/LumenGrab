import { describe, expect, it } from "vitest";
import { lineAndColumn, tidy, tokenizeLine } from "./highlight";

describe("the highlighter", () => {
  it("gives the line back when the pieces are put together", () => {
    for (const line of [
      "  float t = u_phase * 6.2831 * floor(speed + 0.5); // loop",
      "#define PI 3.14159",
      "gl_FragColor = vec4(col, 1.0);",
      "",
      "uniform vec3 u_palette[8];",
    ]) {
      expect(
        tokenizeLine(line)
          .map((t) => t.text)
          .join(""),
      ).toBe(line);
    }
  });

  it("names what each piece is", () => {
    const kinds = Object.fromEntries(
      tokenizeLine("precision mediump float; x = sin(1.5); // c").map((t) => [
        t.text.trim(),
        t.kind,
      ]),
    );
    expect(kinds["precision"]).toBe("keyword");
    expect(kinds["mediump"]).toBe("keyword");
    expect(kinds["float"]).toBe("type");
    expect(kinds["sin"]).toBe("builtin");
    expect(kinds["1.5"]).toBe("number");
    expect(kinds["// c"]).toBe("comment");
    expect(tokenizeLine("#define A 1")[0]?.kind).toBe("directive");
  });
});

describe("tidy", () => {
  it("indents by braces and keeps blank lines", () => {
    expect(tidy("void main() {\nif (a) {\nx();\n}\n\n}\n")).toBe(
      "void main() {\n  if (a) {\n    x();\n  }\n\n}\n",
    );
  });
});

describe("lineAndColumn", () => {
  it("counts from one", () => {
    expect(lineAndColumn("ab\ncd", 0)).toEqual({ line: 1, column: 1 });
    expect(lineAndColumn("ab\ncd", 4)).toEqual({ line: 2, column: 2 });
  });
});
