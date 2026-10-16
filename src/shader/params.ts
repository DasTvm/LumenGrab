import type { GradientStop, ShaderLayer, ShaderParamValue } from "./types";

/**
 * What one setting of a layer is. The Studio draws its Inspector from these descriptions and the
 * renderer sets its uniforms from them, so a kind is described once (`kinds.ts`).
 */
interface SpecBase {
  /** The key in `params`, and the name of the uniform (`u_<id>`). */
  id: string;
  label: string;
  /** The section of the Inspector (`Shape`, `Colour`, `Gradient`, ...). `Motion` and `Advanced` belong to every layer. */
  group: string;
  hint?: string;
  /** Shown only while another setting of the layer has this value (the highlight colour while the source is `custom`). */
  when?: { id: string; equals: string | boolean };
}

export interface NumberSpec extends SpecBase {
  type: "number" | "int";
  min: number;
  max: number;
  step: number;
  default: number;
  /** Shown after the value: `×`, `°`, `px`, `%`. For `%` the stored value 0..1 is shown as 0..100. */
  unit?: "×" | "°" | "px" | "%";
  /** Digits after the point in the field. */
  decimals?: number;
  /** Show a `+` before positive values (grade). */
  signed?: boolean;
}
export interface BoolSpec extends SpecBase {
  type: "bool";
  default: boolean;
}
export interface ColorSpec extends SpecBase {
  type: "color";
  default: string;
}
export interface EnumSpec extends SpecBase {
  type: "enum";
  options: readonly { id: string; label: string }[];
  default: string;
}
export interface StopsSpec extends SpecBase {
  type: "stops";
  default: GradientStop[];
}
export type ParamSpec = NumberSpec | BoolSpec | ColorSpec | EnumSpec | StopsSpec;

const clamp = (v: number, min: number, max: number) => Math.min(max, Math.max(min, v));
const HEX = /^#([0-9a-fA-F]{6}|[0-9a-fA-F]{8})$/;

/** The stops of a gradient, sorted, 2 to 8 of them; anything else becomes the default. */
export function normalizeStops(value: unknown, fallback: GradientStop[]): GradientStop[] {
  if (!Array.isArray(value)) return fallback;
  const stops: GradientStop[] = [];
  for (const entry of value) {
    if (typeof entry !== "object" || entry === null || Array.isArray(entry)) continue;
    const { offset, color } = entry as { offset?: unknown; color?: unknown };
    if (typeof offset !== "number" || typeof color !== "string" || !HEX.test(color)) continue;
    stops.push({ offset: clamp(offset, 0, 1), color });
  }
  if (stops.length < 2) return fallback;
  return stops.slice(0, 8).sort((a, b) => a.offset - b.offset);
}

/** The value of a setting as the renderer uses it: the file's value if it fits, otherwise (or when clamped) a valid one. */
export function readParam(spec: ParamSpec, value: ShaderParamValue | undefined): ShaderParamValue {
  switch (spec.type) {
    case "number":
      return typeof value === "number" && Number.isFinite(value)
        ? clamp(value, spec.min, spec.max)
        : spec.default;
    case "int":
      return typeof value === "number" && Number.isFinite(value)
        ? Math.round(clamp(value, spec.min, spec.max))
        : spec.default;
    case "bool":
      return typeof value === "boolean" ? value : spec.default;
    case "color":
      return typeof value === "string" && HEX.test(value) ? value : spec.default;
    case "enum":
      return typeof value === "string" && spec.options.some((o) => o.id === value)
        ? value
        : spec.default;
    case "stops":
      return normalizeStops(value, spec.default) as unknown as ShaderParamValue;
  }
}

/** All settings of a layer with the defaults filled in and the values made valid. */
export function resolveParams(
  specs: readonly ParamSpec[],
  params: ShaderLayer["params"],
): Record<string, ShaderParamValue> {
  const out: Record<string, ShaderParamValue> = {};
  for (const spec of specs) out[spec.id] = readParam(spec, params[spec.id]);
  return out;
}

export function defaultParams(specs: readonly ParamSpec[]): Record<string, ShaderParamValue> {
  return resolveParams(specs, {});
}

/** How a value is written in a field: `1.2×`, `35°`, `+8`, `90%`. */
export function formatNumber(spec: NumberSpec, value: number): string {
  const shown = spec.unit === "%" ? value * 100 : value;
  const digits = spec.type === "int" ? 0 : (spec.decimals ?? (spec.unit === "%" ? 0 : 2));
  const text = shown.toFixed(digits);
  const signed = spec.signed && shown > 0 ? `+${text}` : text;
  return spec.unit && spec.unit !== "%"
    ? `${signed}${spec.unit === "px" ? " px" : spec.unit}`
    : spec.unit === "%"
      ? `${signed}%`
      : signed;
}
