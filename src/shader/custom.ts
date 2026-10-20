import { SHADER_LIMITS } from "@/document/limits";
import { helperPrelude } from "./glsl";
import type { ParamSpec } from "./params";
import type { LayerRole, ShaderParamValue } from "./types";

/**
 * Your own shader code (docs/FORMAT.md section 4c). The code is one WebGL 1 fragment shader
 * (GLSL ES 1.00). Its settings are written as comments, `// @param float speed = 1.0 [0.0, 4.0]`, and
 * are found here, never by running the code.
 */

export const MAX_CUSTOM_PARAMS = 16;
/** The longest loop a custom shader may contain, in iterations (the check is a text search, the watchdog is the real guard). */
export const MAX_LOOP_ITERATIONS = 256;

export interface ParamPragma {
  spec: ParamSpec;
  /** The line in the code, 1 based. */
  line: number;
}

/** `soft` -> `Soft`, `softEdges` -> `Soft edges`, `tint_color` -> `Tint color`. */
export function labelFromName(name: string): string {
  const words = name
    .replace(/_+/g, " ")
    .replace(/([a-z0-9])([A-Z])/g, "$1 $2")
    .trim()
    .toLowerCase();
  return words.charAt(0).toUpperCase() + words.slice(1);
}

interface PragmaLine {
  type: "float" | "int" | "color" | "bool" | "choice";
  name: string;
  value: string;
  range: string[] | null;
  step: number | null;
  label: string | null;
  group: string | null;
}

/**
 * One `// @param` line: `// @param <float|int|color|bool|choice> <name> = <default> [min, max] step 0.1 "Label" in "Group"`.
 * Everything after the default is optional. A choice lists its options in the brackets: `[Soft, Hard, Glow]`.
 */
function readPragma(text: string): PragmaLine | string {
  const head =
    /^\s*\/\/\s*@param\s+(float|int|color|bool|choice)\s+([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*?)\s*$/.exec(
      text,
    );
  if (!head) return "This @param line is not written like the examples.";
  const [, type = "float", name = "", rest = ""] = head;
  let at = 0;
  const skip = () => {
    while (at < rest.length && /\s/.test(rest.charAt(at))) at += 1;
  };
  let value: string;
  if (rest.startsWith('"')) {
    const end = rest.indexOf('"', 1);
    if (end < 0) return "A quote is not closed.";
    value = rest.slice(1, end);
    at = end + 1;
  } else {
    const m = /^[^\s[]+/.exec(rest);
    value = m ? m[0] : "";
    at = value.length;
  }
  const line: PragmaLine = {
    type: type as PragmaLine["type"],
    name,
    value,
    range: null,
    step: null,
    label: null,
    group: null,
  };
  for (;;) {
    skip();
    if (at >= rest.length) break;
    const here = rest.slice(at);
    let m: RegExpExecArray | null;
    if (here.startsWith("[")) {
      const end = here.indexOf("]");
      if (end < 0) return "A bracket is not closed.";
      line.range = here
        .slice(1, end)
        .split(",")
        .map((part) => part.trim());
      at += end + 1;
    } else if ((m = /^step\s+([-+0-9.eE]+)/.exec(here))) {
      line.step = Number(m[1]);
      at += m[0].length;
    } else if ((m = /^in\s+"([^"]{1,40})"/.exec(here))) {
      line.group = m[1] ?? null;
      at += m[0].length;
    } else if ((m = /^"([^"]{1,40})"/.exec(here))) {
      line.label = m[1] ?? null;
      at += m[0].length;
    } else return "Something after the default is not understood.";
  }
  return line;
}

/** The settings a shader asks for in its comments. Lines that do not parse are reported, not guessed. */
export function parsePragmas(code: string): {
  params: ParamPragma[];
  problems: { line: number; message: string }[];
} {
  const params: ParamPragma[] = [];
  const problems: { line: number; message: string }[] = [];
  const seen = new Set<string>();
  code.split("\n").forEach((text, index) => {
    if (!/^\s*\/\/\s*@param\b/.test(text)) return;
    const line = index + 1;
    const read = readPragma(text);
    if (typeof read === "string") {
      problems.push({ line, message: read });
      return;
    }
    const { type, name, value, range, step, label, group } = read;
    if (name.startsWith("u_") || name.startsWith("gl_")) {
      problems.push({ line, message: `${name} is a reserved name.` });
      return;
    }
    if (seen.has(name)) {
      problems.push({ line, message: `${name} is declared twice.` });
      return;
    }
    if (params.length >= MAX_CUSTOM_PARAMS) {
      problems.push({ line, message: `At most ${String(MAX_CUSTOM_PARAMS)} settings.` });
      return;
    }
    const title = label ?? labelFromName(name);
    const where = group ?? "Settings";
    let spec: ParamSpec;
    if (type === "float" || type === "int") {
      const def = Number(value);
      if (!Number.isFinite(def)) {
        problems.push({ line, message: `${value} is not a number.` });
        return;
      }
      let min = range?.[0] === undefined ? Math.min(0, def) : Number(range[0]);
      let max = range?.[1] === undefined ? Math.max(1, def * 2) : Number(range[1]);
      if (!Number.isFinite(min) || !Number.isFinite(max)) {
        problems.push({ line, message: "The range is not made of numbers." });
        return;
      }
      if (min > max) [min, max] = [max, min];
      min = Math.min(min, def);
      max = Math.max(max, def);
      const whole = type === "int";
      spec = {
        id: name,
        label: title,
        group: where,
        type: whole ? "int" : "number",
        min,
        max,
        step: whole ? 1 : step !== null && step > 0 ? step : (max - min) / 200,
        default: whole ? Math.round(def) : def,
        decimals: whole ? 0 : 2,
      };
    } else if (type === "color") {
      if (!/^#[0-9a-fA-F]{6}$/.test(value)) {
        problems.push({ line, message: "A colour is written like #C8FF2E." });
        return;
      }
      spec = { id: name, label: title, group: where, type: "color", default: value.toUpperCase() };
    } else if (type === "choice") {
      const options = (range ?? []).filter((o) => o !== "");
      if (options.length < 2 || options.length > 12) {
        problems.push({ line, message: "A choice needs 2 to 12 options in [brackets]." });
        return;
      }
      if (!options.includes(value)) {
        problems.push({ line, message: `${value} is not one of the options.` });
        return;
      }
      spec = {
        id: name,
        label: title,
        group: where,
        type: "enum",
        options: options.map((o) => ({ id: o, label: o })),
        default: value,
      };
    } else {
      if (value !== "true" && value !== "false") {
        problems.push({ line, message: "A switch is true or false." });
        return;
      }
      spec = { id: name, label: title, group: where, type: "bool", default: value === "true" };
    }
    seen.add(name);
    params.push({ spec, line });
  });
  return { params, problems };
}

/** The `// @param` line for a setting (the builder writes it into the code). */
export function formatPragma(spec: ParamSpec): string {
  const label = `"${spec.label}"`;
  const group = spec.group !== "Settings" ? ` in "${spec.group}"` : "";
  switch (spec.type) {
    case "number":
      return `// @param float ${spec.id} = ${spec.default.toFixed(Math.max(1, spec.decimals ?? 1))} [${String(spec.min)}, ${String(spec.max)}] step ${String(spec.step)} ${label}${group}`;
    case "int":
      return `// @param int ${spec.id} = ${String(spec.default)} [${String(spec.min)}, ${String(spec.max)}] ${label}${group}`;
    case "color":
      return `// @param color ${spec.id} = ${spec.default} ${label}${group}`;
    case "bool":
      return `// @param bool ${spec.id} = ${String(spec.default)} ${label}${group}`;
    case "enum":
      return `// @param choice ${spec.id} = ${spec.default} [${spec.options.map((o) => o.id).join(", ")}] ${label}${group}`;
    case "stops":
      return "";
  }
}

/** The GLSL type a setting is declared with. */
export function uniformTypeOf(spec: ParamSpec): string {
  switch (spec.type) {
    case "color":
      return "vec3";
    case "bool":
      return "bool";
    default:
      return "float";
  }
}

export type CodeCheck =
  { ok: true } | { ok: false; kind: "too-long" | "rejected"; message: string; line?: number };

/**
 * The text checks every custom shader passes before it is compiled: size, directives that could
 * change the dialect, and loops longer than the limit. The compiler does the rest (WebGL 1 allows only
 * loops with a constant count), and a frame watchdog catches code that is merely slow.
 */
export function checkCustomCode(code: string): CodeCheck {
  if (code.length > SHADER_LIMITS.maxCodeLength) {
    return {
      ok: false,
      kind: "too-long",
      message:
        "The code is too long to compile. Shorten it, then try again. Comments and blank lines count too.",
    };
  }
  const lines = code.split("\n");
  for (let i = 0; i < lines.length; i += 1) {
    const text = lines[i] ?? "";
    const directive = /^\s*#\s*(extension|version|include|pragma)\b/.exec(text);
    if (directive) {
      return {
        ok: false,
        kind: "rejected",
        line: i + 1,
        message: `#${directive[1] ?? ""} is not allowed. The shader is GLSL ES 1.00 with no extensions.`,
      };
    }
    for (const loop of text.matchAll(
      /for\s*\(\s*(?:int|float)\s+\w+\s*=\s*(-?\d+(?:\.\d+)?)\s*;\s*\w+\s*(<=?|>=?|!=)\s*(-?\d+(?:\.\d+)?)/g,
    )) {
      const from = Number(loop[1]);
      const to = Number(loop[3]);
      if (Math.abs(to - from) > MAX_LOOP_ITERATIONS) {
        return {
          ok: false,
          kind: "rejected",
          line: i + 1,
          message: `A loop may run at most ${String(MAX_LOOP_ITERATIONS)} times.`,
        };
      }
    }
  }
  if (!/\bvoid\s+main\s*\(/.test(code)) {
    return { ok: false, kind: "rejected", message: "The shader needs a void main() function." };
  }
  if (!/\bgl_FragColor\b/.test(code)) {
    return { ok: false, kind: "rejected", message: "Write the colour to gl_FragColor." };
  }
  return { ok: true };
}

/** The shader exactly as it is compiled: our helpers first, then the code from line 1 (so error lines are the user's lines). */
export function assembleCustom(code: string): string {
  return `precision mediump float;\n${helperPrelude(code)}#line 1\n${code}`;
}

/** `ERROR: 0:15: 'sinn' : no matching overloaded function found` -> line 15 and the message. */
export function parseCompileLog(log: string): { line: number | null; message: string } {
  const first = log
    .split("\n")
    .map((l) => l.trim())
    .find((l) => /^ERROR:/i.test(l));
  if (!first) return { line: null, message: log.trim() || "The shader did not compile." };
  const m = /^ERROR:\s*\d+:(\d+):\s*(.*)$/i.exec(first);
  if (!m) return { line: null, message: first.replace(/^ERROR:\s*/i, "") };
  return { line: Number(m[1]), message: (m[2] ?? "").trim() };
}

/** The values a custom layer has for its settings: the file's if they fit, otherwise the defaults. */
export function customValues(
  specs: readonly ParamSpec[],
  params: Record<string, ShaderParamValue>,
): Record<string, number | boolean | string> {
  const out: Record<string, number | boolean | string> = {};
  for (const spec of specs) {
    const value = params[spec.id];
    if (spec.type === "number" || spec.type === "int") {
      const n = typeof value === "number" && Number.isFinite(value) ? value : spec.default;
      out[spec.id] = Math.min(
        spec.max,
        Math.max(spec.min, spec.type === "int" ? Math.round(n) : n),
      );
    } else if (spec.type === "bool") {
      out[spec.id] = typeof value === "boolean" ? value : spec.default;
    } else if (spec.type === "color") {
      out[spec.id] =
        typeof value === "string" && /^#[0-9a-fA-F]{6}/.test(value) ? value : spec.default;
    } else if (spec.type === "enum") {
      out[spec.id] =
        typeof value === "string" && spec.options.some((o) => o.id === value)
          ? value
          : spec.default;
    }
  }
  return out;
}

/** What a shader is, read from its code: one that reads `u_input` changes the picture below it, any other draws one. */
export function detectRole(code: string): LayerRole {
  const bare = code.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/.*$/gm, "");
  return /\bu_input\b/.test(bare) ? "effect" : "generator";
}

export interface Example {
  id: string;
  name: string;
  blurb: string;
  role: LayerRole;
  code: string;
}

const GEN_HEAD = `precision mediump float;
uniform vec2 u_resolution;
uniform float u_phase;
uniform vec3 u_palette[8];
`;
const FX_HEAD = `precision mediump float;
uniform vec2 u_resolution;
uniform float u_phase;
uniform sampler2D u_input;
`;

export const EXAMPLES: readonly Example[] = [
  {
    id: "plasma",
    name: "Plasma",
    blurb: "Colourful flowing bands",
    role: "generator",
    code: `// @param float speed = 1.0 [0.0, 4.0]
// @param float scale = 3.0 [1.0, 8.0]
// @param bool soft = true "Soft edges"
${GEN_HEAD}uniform float speed;
uniform float scale;
uniform bool soft;

void main() {
  vec2 uv = gl_FragCoord.xy / u_resolution;
  vec2 p = (uv - 0.5) * scale * vec2(u_resolution.x / u_resolution.y, 1.0);
  float t = u_phase * 6.28318 * floor(speed + 0.5);
  float v = sin(p.x * 1.7 + t) + sin(p.y * 2.1 - t) + sin((p.x + p.y) * 1.3 + t * 2.0);
  v = v / 6.0 + 0.5;
  float edge = soft ? 0.5 : 0.02;
  vec3 col = mix(u_palette[0], u_palette[1], smoothstep(0.5 - edge, 0.5 + edge, v));
  col = mix(col, u_palette[2], smoothstep(0.8 - edge, 0.8 + edge, v));
  gl_FragColor = vec4(col, 1.0);
}
`,
  },
  {
    id: "soft-clouds",
    name: "Soft clouds",
    blurb: "Slow layered noise",
    role: "generator",
    code: `// @param float speed = 1.0 [0.0, 4.0]
// @param float scale = 2.5 [0.5, 8.0]
${GEN_HEAD}uniform float speed;
uniform float scale;

void main() {
  vec2 uv = gl_FragCoord.xy / u_resolution;
  vec2 p = uv * vec2(u_resolution.x / u_resolution.y, 1.0) * scale;
  float a = u_phase * 6.28318 * floor(speed + 0.5);
  vec2 drift = vec2(cos(a), sin(a)) * 0.6;
  float n = fbm(p + drift) * 0.7 + fbm(p * 2.0 - drift) * 0.3;
  vec3 col = mix(u_palette[0], u_palette[1], smoothstep(0.25, 0.75, n));
  gl_FragColor = vec4(col, 1.0);
}
`,
  },
  {
    id: "starfield",
    name: "Starfield",
    blurb: "Twinkling points",
    role: "generator",
    code: `// @param float density = 0.5 [0.1, 1.0]
// @param float twinkle = 0.6 [0.0, 1.0]
// @param color star = #FFFFFF
${GEN_HEAD}uniform float density;
uniform float twinkle;
uniform vec3 star;

void main() {
  vec2 p = gl_FragCoord.xy / u_resolution.y * 24.0;
  vec2 cell = floor(p);
  vec2 f = fract(p) - 0.5;
  float h = noise(cell * 1.7);
  float on = step(h, density * 0.5);
  float size = 0.05 + 0.1 * noise(cell + 9.0);
  float d = length(f - (vec2(noise(cell + 3.0), noise(cell + 5.0)) - 0.5) * 0.6);
  float blink = 1.0 - twinkle * 0.5 * (1.0 + sin(u_phase * 6.28318 * 2.0 + h * 40.0));
  float s = smoothstep(size, 0.0, d) * on * blink;
  vec3 col = mix(u_palette[0], star, s);
  gl_FragColor = vec4(col, 1.0);
}
`,
  },
  {
    id: "light-sweep",
    name: "Light sweep",
    blurb: "A soft highlight crosses the layers below",
    role: "effect",
    code: `// @param float width = 0.25 [0.05, 0.6]
// @param float strength = 0.5 [0.0, 1.0]
// @param color tint = #FFFFFF
${FX_HEAD}uniform float width;
uniform float strength;
uniform vec3 tint;

void main() {
  vec2 uv = gl_FragCoord.xy / u_resolution;
  vec3 base = texture2D(u_input, uv).rgb;
  float x = fract(u_phase) * 1.8 - 0.4;
  float band = smoothstep(width, 0.0, abs(uv.x + uv.y * 0.35 - x));
  gl_FragColor = vec4(base + tint * band * strength, 1.0);
}
`,
  },
  {
    id: "chromatic-wobble",
    name: "Chromatic wobble",
    blurb: "Colour fringes that breathe",
    role: "effect",
    code: `// @param float amount = 0.006 [0.0, 0.03]
${FX_HEAD}uniform float amount;

void main() {
  vec2 uv = gl_FragCoord.xy / u_resolution;
  float s = sin(u_phase * 6.28318) * amount;
  vec2 d = vec2(s, s * 0.5);
  float r = texture2D(u_input, uv + d).r;
  float g = texture2D(u_input, uv).g;
  float b = texture2D(u_input, uv - d).b;
  gl_FragColor = vec4(r, g, b, 1.0);
}
`,
  },
  {
    id: "pixel-melt",
    name: "Pixel melt",
    blurb: "Blocks that drip and settle",
    role: "effect",
    code: `// @param float blocks = 24.0 [6.0, 80.0]
// @param float drip = 0.08 [0.0, 0.3]
${FX_HEAD}uniform float blocks;
uniform float drip;

void main() {
  vec2 uv = gl_FragCoord.xy / u_resolution;
  vec2 cells = vec2(blocks * u_resolution.x / u_resolution.y, blocks);
  vec2 cell = floor(uv * cells);
  float h = noise(vec2(cell.x, 3.0));
  float fall = (0.5 + 0.5 * sin(u_phase * 6.28318 + h * 6.28318)) * drip;
  vec2 p = (cell + 0.5) / cells;
  p.y += fall * h;
  gl_FragColor = vec4(texture2D(u_input, p).rgb, 1.0);
}
`,
  },
  {
    id: "blank-generator",
    name: "Blank generator",
    blurb: "Colour from nothing",
    role: "generator",
    code: `// @param float speed = 1.0 [0.0, 4.0]
${GEN_HEAD}uniform float speed;

void main() {
  vec2 uv = gl_FragCoord.xy / u_resolution;
  float t = u_phase * 6.28318 * floor(speed + 0.5);
  float wave = sin(uv.x * 4.0 + t) * 0.5 + 0.5;
  gl_FragColor = vec4(mix(u_palette[0], u_palette[1], mix(uv.y, wave, 0.4)), 1.0);
}
`,
  },
  {
    id: "blank-effect",
    name: "Blank effect",
    blurb: "Edit the layers below",
    role: "effect",
    code: `// @param float amount = 1.0 [0.0, 1.0]
${FX_HEAD}uniform float amount;

void main() {
  vec2 uv = gl_FragCoord.xy / u_resolution;
  vec3 base = texture2D(u_input, uv).rgb;
  gl_FragColor = vec4(mix(base, 1.0 - base, amount), 1.0);
}
`,
  },
];

export const exampleById = (id: string): Example | undefined => EXAMPLES.find((e) => e.id === id);

/** The brief "Copy for AI" puts on the clipboard (the AI never runs inside LumenGrab, nothing is sent anywhere). */
export function aiBrief(options: { code?: string; example?: string }): string {
  const parts = [
    `You are writing a fragment shader for LumenGrab's Background Studio.

TARGET
- WebGL 1, GLSL ES 1.00. One fragment shader, no extensions.
- Start with: precision mediump float;
- Write the colour to gl_FragColor.

INPUTS (declare the ones you use)
uniform vec2  u_resolution;   // size in pixels
uniform float u_phase;        // 0..1, repeats every loop
uniform float u_seed;
uniform vec3  u_palette[8];   // Studio palette
uniform sampler2D u_input;    // layers below (effects)

HELPERS: noise(vec2), fbm(vec2), hsv2rgb(vec3), rot(float)

LOOPING: it must loop without a jump. Use sin(u_phase * 6.28318 * N) with whole N.

SETTINGS: declare them in comments and as uniforms, for example
// @param float speed = 1.0 [0.0, 4.0]
// @param color tint = #C8FF2E
// @param bool soft = true

RULES: loops need a constant count (at most ${String(MAX_LOOP_ITERATIONS)}), no #extension, no #version, at most ${String(SHADER_LIMITS.maxCodeLength)} characters.

MY REQUEST
(describe your effect here)`,
  ];
  if (options.example) parts.push(`A WORKING EXAMPLE\n${options.example}`);
  if (options.code) parts.push(`MY CURRENT CODE\n${options.code}`);
  return parts.join("\n\n");
}
