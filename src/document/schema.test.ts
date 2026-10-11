import { describe, expect, it } from "vitest";
import { LayerSchema, ProjectSchema } from "./schema";
import { defaultProject } from "./write";

const base = { id: "l1", visible: true, locked: false };

const layers: Record<string, unknown> = {
  arrow: {
    ...base,
    type: "arrow",
    from: { x: 1, y: 2 },
    to: { x: 30, y: 40 },
    style: "curved",
    color: "#FF0000",
    width: 4,
    curve: { x: 5, y: 6 },
  },
  line: {
    ...base,
    type: "line",
    from: { x: 0, y: 0 },
    to: { x: 9, y: 9 },
    color: "#00FF00AA",
    width: 2,
    dash: [4, 2],
  },
  rect: {
    ...base,
    type: "rect",
    x: 1,
    y: 2,
    width: 3,
    height: 4,
    rotation: 15,
    stroke: "#000000",
    fill: null,
    strokeWidth: 2,
    radius: 4,
  },
  ellipse: {
    ...base,
    type: "ellipse",
    x: 1,
    y: 2,
    width: 3,
    height: 4,
    rotation: 0,
    stroke: null,
    fill: "#FFFFFF80",
    strokeWidth: 0,
  },
  text: {
    ...base,
    type: "text",
    x: 1,
    y: 2,
    width: null,
    text: "Hello",
    fontId: "inter",
    size: 24,
    weight: 600,
    color: "#111111",
    background: null,
    align: "left",
    rotation: 0,
  },
  counter: { ...base, type: "counter", x: 5, y: 5, value: 3, color: "#FF0000", size: 28 },
  pencil: {
    ...base,
    type: "pencil",
    points: [0, 0, 1, 1, 2, 3],
    color: "#0000FF",
    width: 3,
    smoothing: 0.5,
  },
  highlighter: {
    ...base,
    type: "highlighter",
    rect: { x: 1, y: 2, width: 30, height: 10 },
    color: "#FFFF00",
    opacity: 0.4,
  },
  spotlight: {
    ...base,
    type: "spotlight",
    rect: { x: 1, y: 2, width: 30, height: 10 },
    shape: "ellipse",
    dimOpacity: 0.6,
  },
  redaction: {
    ...base,
    type: "redaction",
    mode: "pixelate",
    rect: { x: 1, y: 2, width: 30, height: 10 },
    strength: 8,
    seed: 42,
  },
};

describe("layer schemas", () => {
  it.each(Object.entries(layers))("accepts a valid %s layer", (_name, layer) => {
    expect(LayerSchema.safeParse(layer).success).toBe(true);
  });

  it("keeps fields it does not know, on layers and nested objects", () => {
    const layer = {
      ...(layers["arrow"] as object),
      fromTheFuture: { deep: [1, 2] },
      from: { x: 1, y: 2, z: 3 },
    };
    const parsed = LayerSchema.parse(layer);
    expect(parsed).toMatchObject({ fromTheFuture: { deep: [1, 2] }, from: { x: 1, y: 2, z: 3 } });
  });

  it("keeps a layer type from a newer version as an opaque layer", () => {
    const stamp = { id: "s1", type: "stamp", visible: true, shape: "star", points: 5 };
    expect(LayerSchema.parse(stamp)).toEqual(stamp);
  });

  it("does not hide a known type with broken fields behind the opaque fallback", () => {
    expect(LayerSchema.safeParse({ ...(layers["rect"] as object), width: "wide" }).success).toBe(
      false,
    );
    expect(
      LayerSchema.safeParse({ ...(layers["redaction"] as object), mode: "smudge" }).success,
    ).toBe(false);
  });

  it("rejects bad colors, negative sizes and out-of-range opacity", () => {
    expect(LayerSchema.safeParse({ ...(layers["line"] as object), color: "red" }).success).toBe(
      false,
    );
    expect(LayerSchema.safeParse({ ...(layers["line"] as object), width: -1 }).success).toBe(false);
    expect(
      LayerSchema.safeParse({ ...(layers["highlighter"] as object), opacity: 2 }).success,
    ).toBe(false);
  });

  it("clamps absurd coordinates and rejects non-finite ones", () => {
    const wild = { ...(layers["rect"] as object), x: 1e300, y: -1e300 };
    expect(LayerSchema.parse(wild)).toMatchObject({ x: 1e6, y: -1e6 });
    // JSON has no Infinity, but 1e999 parses to it.
    const infinite = JSON.parse('{"x": 1e999, "y": 0}') as { x: number; y: number };
    expect(LayerSchema.safeParse({ ...(layers["counter"] as object), ...infinite }).success).toBe(
      false,
    );
    expect(LayerSchema.safeParse({ ...(layers["counter"] as object), x: Number.NaN }).success).toBe(
      false,
    );
  });
});

describe("group layers (format v2)", () => {
  const group = (children: unknown[], extra: object = {}) => ({
    id: "g",
    visible: true,
    locked: false,
    type: "group",
    layers: children,
    ...extra,
  });

  it("accepts a group with children, nested groups and unknown fields, and keeps them", () => {
    const value = group([layers["rect"], group([layers["arrow"]], { id: "g2" })], {
      name: "Callout",
      fromTheFuture: { keep: 1 },
    });
    const parsed = LayerSchema.parse(value);
    expect(parsed).toEqual(value);
  });

  it("names the field of a broken child with the full path", () => {
    const bad = group([group([{ ...(layers["rect"] as object), width: "wide" }], { id: "g2" })]);
    const result = ProjectSchema.safeParse({ ...defaultProject(), layers: [layers["arrow"], bad] });
    expect(result.success).toBe(false);
    expect(result.error?.issues[0]?.path).toEqual(["layers", 1, "layers", 0, "layers", 0, "width"]);
  });

  it("does not turn a group with a bad body into an opaque layer", () => {
    expect(LayerSchema.safeParse(group("nope" as unknown as unknown[])).success).toBe(false);
    expect(LayerSchema.safeParse({ ...group([]), visible: "yes" }).success).toBe(false);
  });

  it("allows eight nested groups and rejects the ninth", () => {
    const nest = (levels: number): unknown =>
      levels === 0 ? layers["rect"] : group([nest(levels - 1)], { id: `g${String(levels)}` });
    expect(LayerSchema.safeParse(nest(8)).success).toBe(true);
    expect(LayerSchema.safeParse(nest(9)).success).toBe(false);
  });
});

describe("project schema", () => {
  it("accepts the default project and keeps unknown top-level fields", () => {
    const project = { ...defaultProject(), layers: Object.values(layers), later: { a: 1 } };
    const parsed = ProjectSchema.parse(project);
    expect(parsed.layers).toHaveLength(10);
    expect(parsed).toMatchObject({ later: { a: 1 } });
  });

  it("requires every part of the presentation", () => {
    const broken = Object.fromEntries(
      Object.entries(defaultProject().presentation).filter(([key]) => key !== "shadow"),
    );
    expect(ProjectSchema.safeParse({ ...defaultProject(), presentation: broken }).success).toBe(
      false,
    );
  });

  it("accepts every background type of the spec and rejects an unknown one", () => {
    const withBackground = (background: unknown) => ({
      ...defaultProject(),
      presentation: { ...defaultProject().presentation, background },
    });
    for (const background of [
      { type: "solid", color: "#FFFFFF" },
      {
        type: "gradient",
        angle: 45,
        stops: [
          { offset: 0, color: "#000000" },
          { offset: 1, color: "#FFFFFF" },
        ],
      },
      { type: "mesh", seed: 7, colors: ["#FF0000", "#00FF00"] },
      { type: "image", asset: `${"a".repeat(64)}.png`, fit: "cover" },
      { type: "transparent" },
    ]) {
      expect(ProjectSchema.safeParse(withBackground(background)).success).toBe(true);
    }
    expect(ProjectSchema.safeParse(withBackground({ type: "plasma" })).success).toBe(false);
  });

  it("allows a crop of null or a rectangle", () => {
    expect(
      ProjectSchema.safeParse({ ...defaultProject(), crop: { x: 0, y: 0, width: 10, height: 5 } })
        .success,
    ).toBe(true);
    expect(ProjectSchema.safeParse({ ...defaultProject(), crop: { x: 0, y: 0 } }).success).toBe(
      false,
    );
  });
});
