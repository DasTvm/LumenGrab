import { z } from "zod";
import { MAX_COORDINATE } from "./limits";

/**
 * Zod schemas of `manifest.json` and `project.json` (docs/FORMAT.md sections 3 and 4).
 *
 * Every object is a `looseObject`: fields this version does not know survive parsing and are written
 * back on save (AGENTS.md section 5, rule 4). Numbers are finite (Zod rejects NaN and Infinity) and
 * are clamped to +-MAX_COORDINATE, so a hostile file cannot make the renderer allocate absurd sizes.
 */

const clamp = (v: number) => Math.max(-MAX_COORDINATE, Math.min(MAX_COORDINATE, v));
/** A coordinate or length in source-image pixels. */
const num = z.number().transform(clamp);
/** A length that cannot be negative. */
const size = z.number().min(0).transform(clamp);
const unit = z.number().min(0).max(1);
const color = z.string().regex(/^#([0-9a-fA-F]{6}|[0-9a-fA-F]{8})$/);
const id = z.string().min(1).max(64);
const text = z.string().max(100_000);

export const PointSchema = z.looseObject({ x: num, y: num });
export const RectSchema = z.looseObject({ x: num, y: num, width: size, height: size });

const base = {
  id,
  visible: z.boolean(),
  locked: z.boolean(),
  name: z.string().max(200).optional(),
};

const ArrowSchema = z.looseObject({
  ...base,
  type: z.literal("arrow"),
  from: PointSchema,
  to: PointSchema,
  style: z.enum(["straight", "curved", "outlined", "double"]),
  color,
  width: size,
  curve: PointSchema.optional(),
});
const LineSchema = z.looseObject({
  ...base,
  type: z.literal("line"),
  from: PointSchema,
  to: PointSchema,
  color,
  width: size,
  dash: z.array(size).max(16).optional(),
});
const RectLayerSchema = z.looseObject({
  ...base,
  type: z.literal("rect"),
  x: num,
  y: num,
  width: size,
  height: size,
  rotation: num,
  stroke: color.nullable(),
  fill: color.nullable(),
  strokeWidth: size,
  radius: size,
});
const EllipseSchema = z.looseObject({
  ...base,
  type: z.literal("ellipse"),
  x: num,
  y: num,
  width: size,
  height: size,
  rotation: num,
  stroke: color.nullable(),
  fill: color.nullable(),
  strokeWidth: size,
});
const TextSchema = z.looseObject({
  ...base,
  type: z.literal("text"),
  x: num,
  y: num,
  width: size.nullable(),
  text,
  fontId: z.string().max(64),
  size,
  weight: z.number().int().min(1).max(1000),
  color,
  background: color.nullable(),
  align: z.enum(["left", "center", "right"]),
  rotation: num,
});
const CounterSchema = z.looseObject({
  ...base,
  type: z.literal("counter"),
  x: num,
  y: num,
  value: z.number().int().min(-1_000_000).max(1_000_000),
  color,
  size,
});
const PencilSchema = z.looseObject({
  ...base,
  type: z.literal("pencil"),
  /** `[x0, y0, x1, y1, ...]` */
  points: z.array(num).max(400_000),
  color,
  width: size,
  smoothing: unit,
});
const HighlighterSchema = z.looseObject({
  ...base,
  type: z.literal("highlighter"),
  rect: RectSchema,
  color,
  opacity: unit,
});
const SpotlightSchema = z.looseObject({
  ...base,
  type: z.literal("spotlight"),
  rect: RectSchema,
  shape: z.enum(["rect", "ellipse"]),
  dimOpacity: unit,
});
export const RedactionSchema = z.looseObject({
  ...base,
  type: z.literal("redaction"),
  mode: z.enum(["blur", "pixelate", "solid"]),
  rect: RectSchema,
  /** Blur radius or pixelate block size. */
  strength: size,
  /** Solid mode. */
  color: color.optional(),
  /** Seed of the pixelate randomisation, so an export is deterministic. */
  seed: z.number().int().min(0).max(0xffffffff),
});

const KNOWN_LAYERS = [
  ArrowSchema,
  LineSchema,
  RectLayerSchema,
  EllipseSchema,
  TextSchema,
  CounterSchema,
  PencilSchema,
  HighlighterSchema,
  SpotlightSchema,
  RedactionSchema,
] as const;

export const KNOWN_LAYER_TYPES: readonly string[] = [
  "arrow",
  "line",
  "rect",
  "ellipse",
  "text",
  "counter",
  "pencil",
  "highlighter",
  "spotlight",
  "redaction",
];

/**
 * A layer type this version does not know (a newer version added it additively). It is kept as it is,
 * not drawn, and written back. A *known* type with bad fields is an error, not an opaque layer.
 */
export const OpaqueLayerSchema = z
  .looseObject({ id, type: z.string().min(1).max(64) })
  .refine((layer) => !KNOWN_LAYER_TYPES.includes(layer.type), {
    message: "known layer type with invalid fields",
  });

const KnownLayerSchema = z.discriminatedUnion("type", KNOWN_LAYERS);
type KnownLayer = z.infer<typeof KnownLayerSchema>;
export type OpaqueLayer = z.infer<typeof OpaqueLayerSchema>;
export type Layer = KnownLayer | OpaqueLayer;

/**
 * One layer. The `type` decides which schema applies, so an error names the real problem
 * (`layers.2.width`) instead of "no union branch matched".
 */
export const LayerSchema: z.ZodType<Layer> = z.any().transform((value: unknown, ctx) => {
  const type = (value as { type?: unknown } | null)?.type;
  const schema =
    typeof type === "string" && KNOWN_LAYER_TYPES.includes(type)
      ? KnownLayerSchema
      : OpaqueLayerSchema;
  const result = schema.safeParse(value);
  if (result.success) return result.data;
  for (const issue of result.error.issues) {
    ctx.addIssue({ code: "custom", message: issue.message, path: issue.path });
  }
  return z.NEVER;
});

const BackgroundSchema = z.discriminatedUnion("type", [
  z.looseObject({ type: z.literal("solid"), color }),
  z.looseObject({
    type: z.literal("gradient"),
    angle: num,
    stops: z
      .array(z.looseObject({ offset: unit, color }))
      .min(2)
      .max(16),
  }),
  z.looseObject({
    type: z.literal("mesh"),
    seed: z.number().int().min(0).max(0xffffffff),
    colors: z.array(color).min(1).max(16),
  }),
  z.looseObject({
    type: z.literal("image"),
    /** File name inside `assets/`: `<sha256>.<ext>`. */
    asset: z.string().max(200),
    fit: z.enum(["cover", "contain"]),
  }),
  z.looseObject({ type: z.literal("transparent") }),
]);

export const PresentationSchema = z.looseObject({
  enabled: z.boolean(),
  background: BackgroundSchema,
  padding: z.looseObject({ top: size, right: size, bottom: size, left: size }),
  autoBalance: z.boolean(),
  cornerRadius: size,
  shadow: z.looseObject({
    enabled: z.boolean(),
    x: num,
    y: num,
    blur: size,
    spread: num,
    color,
  }),
  frame: z.looseObject({
    type: z.enum(["none", "macos-window", "windows-window", "browser"]),
    title: z.string().max(500).optional(),
    url: z.string().max(2000).optional(),
  }),
  aspect: z.looseObject({
    mode: z.enum(["free", "fixed"]),
    ratio: z.tuple([z.number().positive(), z.number().positive()]).optional(),
  }),
  exportScale: z.number().min(0.1).max(16),
});

export const ProjectSchema = z.looseObject({
  version: z.number().int().min(1),
  crop: RectSchema.nullable(),
  layers: z.array(LayerSchema),
  presentation: PresentationSchema,
});

const sha256 = z.string().regex(/^[0-9a-f]{64}$/);

export const ManifestSchema = z.looseObject({
  format: z.literal("lumengrab"),
  formatVersion: z.number().int().min(1),
  minReaderVersion: z.number().int().min(1),
  createdBy: z.string().max(200),
  createdAt: z.string().max(64),
  modifiedAt: z.string().max(64),
  documentId: z.string().min(1).max(64),
  source: z.looseObject({
    file: z.literal("source.png"),
    width: z.number().int().min(1).max(1_000_000),
    height: z.number().int().min(1).max(1_000_000),
    scale: z.number().positive().max(64),
    sha256,
  }),
});

export type Point = z.infer<typeof PointSchema>;
export type Rect = z.infer<typeof RectSchema>;
export type Redaction = z.infer<typeof RedactionSchema>;
export type Presentation = z.infer<typeof PresentationSchema>;
export type Project = z.infer<typeof ProjectSchema>;
export type Manifest = z.infer<typeof ManifestSchema>;

/** True for a layer this version knows how to draw and edit. */
export function isKnownLayer(layer: Layer): layer is KnownLayer {
  return KNOWN_LAYER_TYPES.includes(layer.type);
}
