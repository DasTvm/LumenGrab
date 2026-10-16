import type { Presentation } from "@/document/schema";

/** A moving background (format v4, docs/FORMAT.md section 4c). */
export type ShaderScene = Extract<Presentation["background"], { type: "shader" }>;
export type ShaderLayer = ShaderScene["layers"][number];
export type ShaderParamValue = ShaderLayer["params"][string];
export type BlendMode = ShaderLayer["blend"];
export type LayerRole = "generator" | "effect";
export type Direction = NonNullable<ShaderLayer["direction"]>;

export const DIRECTIONS: readonly Direction[] = ["right", "left", "up", "down"];

/** What can be changed on a layer besides its settings. (`ShaderLayer` has an index signature for unknown fields, so `Partial<Omit<...>>` would accept anything.) */
export interface LayerPatch {
  name?: string;
  enabled?: boolean;
  opacity?: number;
  blend?: BlendMode;
  speed?: number;
  direction?: Direction;
  seed?: number;
  role?: LayerRole;
  code?: string;
}

export interface GradientStop {
  offset: number;
  color: string;
}

export const BLEND_MODES: readonly { id: BlendMode; label: string }[] = [
  { id: "normal", label: "Normal" },
  { id: "add", label: "Add" },
  { id: "screen", label: "Screen" },
  { id: "multiply", label: "Multiply" },
  { id: "overlay", label: "Overlay" },
  { id: "soft-light", label: "Soft light" },
];

/** The version of the rendering rules this build draws (docs/FORMAT.md section 4c). */
export const ENGINE_VERSION = 1;
