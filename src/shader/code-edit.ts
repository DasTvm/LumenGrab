import { formatPragma, parsePragmas, uniformTypeOf } from "./custom";
import type { ParamSpec } from "./params";

/**
 * What the settings builder does to the code: a setting is a `// @param` line and a matching `uniform`
 * line, and both are kept in step. Pure text, so the builder and the code never disagree.
 */

const uniformLine = (spec: ParamSpec) => `uniform ${uniformTypeOf(spec)} ${spec.id};`;

const declaration = (name: string) =>
  new RegExp(`^\\s*uniform\\s+(?:float|int|bool|vec3|vec2|vec4)\\s+${name}\\s*;\\s*$`);

/** The setting named `name`, written again from `spec`: its @param line, and its uniform if the type changed. */
export function updateSetting(code: string, name: string, spec: ParamSpec): string {
  const found = parsePragmas(code).params.find((p) => p.spec.id === name);
  if (!found) return code;
  const lines = code.split("\n");
  lines[found.line - 1] = formatPragma({ ...spec, id: name });
  const at = lines.findIndex((l) => declaration(name).test(l));
  if (at >= 0) lines[at] = uniformLine({ ...spec, id: name });
  return lines.join("\n");
}

/** A name for a new setting that the code does not use yet: `setting`, `setting2`, ... */
export function uniqueName(code: string, base = "setting"): string {
  let name = base;
  for (let i = 2; new RegExp(`\\b${name}\\b`).test(code); i += 1) name = `${base}${String(i)}`;
  return name;
}

/** Adds a setting: its @param line after the last one (or at the top) and its uniform after the last uniform (or before `main`). */
export function addSetting(code: string, spec: ParamSpec): string {
  const lines = code.split("\n");
  let pragma = -1;
  let uniform = -1;
  let precision = -1;
  let main = -1;
  lines.forEach((l, i) => {
    if (/^\s*\/\/\s*@param\b/.test(l)) pragma = i;
    if (/^\s*uniform\b/.test(l)) uniform = i;
    if (/^\s*precision\b/.test(l)) precision = i;
    if (main < 0 && /\bvoid\s+main\s*\(/.test(l)) main = i;
  });
  const decl = uniformLine(spec);
  const declAt =
    uniform >= 0 ? uniform + 1 : precision >= 0 ? precision + 1 : main >= 0 ? main : lines.length;
  lines.splice(declAt, 0, decl);
  // The pragma goes in above, so the uniform's index may have moved by one.
  const pragmaAt = pragma >= 0 ? pragma + 1 : 0;
  lines.splice(pragmaAt, 0, formatPragma(spec));
  return lines.join("\n");
}

/** Takes a setting away: its @param line and its uniform. */
export function removeSetting(code: string, name: string): string {
  const found = parsePragmas(code).params.find((p) => p.spec.id === name);
  const lines = code.split("\n");
  const keep = lines.filter(
    (l, i) => !(found && i === found.line - 1) && !declaration(name).test(l),
  );
  return keep.join("\n");
}

/** Moves a setting's @param line to another place among the @param lines (the order of the controls). */
export function moveSetting(code: string, name: string, to: number): string {
  const { params } = parsePragmas(code);
  const from = params.findIndex((p) => p.spec.id === name);
  if (from < 0 || to < 0 || to >= params.length || to === from) return code;
  const lines = code.split("\n");
  const texts = params.map((p) => lines[p.line - 1] ?? "");
  const [moved] = texts.splice(from, 1);
  texts.splice(to, 0, moved ?? "");
  params.forEach((p, i) => {
    lines[p.line - 1] = texts[i] ?? "";
  });
  return lines.join("\n");
}
