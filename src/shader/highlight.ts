/** A very small GLSL highlighter for the shader editor: comments, directives, keywords, types, numbers and our functions. */
export type TokenKind =
  "comment" | "directive" | "keyword" | "type" | "number" | "builtin" | "plain";

export interface Token {
  text: string;
  kind: TokenKind;
}

const KEYWORDS = new Set([
  "precision",
  "uniform",
  "varying",
  "attribute",
  "const",
  "void",
  "if",
  "else",
  "for",
  "while",
  "return",
  "break",
  "continue",
  "discard",
  "in",
  "out",
  "inout",
  "highp",
  "mediump",
  "lowp",
  "struct",
  "true",
  "false",
]);
const TYPES = new Set([
  "float",
  "int",
  "bool",
  "vec2",
  "vec3",
  "vec4",
  "mat2",
  "mat3",
  "mat4",
  "sampler2D",
  "ivec2",
  "ivec3",
  "bvec2",
]);
const BUILTINS = new Set([
  "sin",
  "cos",
  "tan",
  "atan",
  "pow",
  "exp",
  "log",
  "sqrt",
  "abs",
  "sign",
  "floor",
  "ceil",
  "fract",
  "mod",
  "min",
  "max",
  "clamp",
  "mix",
  "step",
  "smoothstep",
  "length",
  "distance",
  "dot",
  "cross",
  "normalize",
  "reflect",
  "texture2D",
  "noise",
  "fbm",
  "hsv2rgb",
  "rot",
]);

const PATTERN =
  /(\/\/[^\n]*)|(#[ \t]*[a-zA-Z]+)|(\b\d+\.?\d*(?:[eE][-+]?\d+)?\b|\.\d+)|([A-Za-z_][A-Za-z0-9_]*)|([\s\S])/g;

/** Splits one line of code into coloured pieces. The pieces put together are the line again. */
export function tokenizeLine(line: string): Token[] {
  const tokens: Token[] = [];
  const push = (text: string, kind: TokenKind) => {
    const last = tokens[tokens.length - 1];
    if (last && last.kind === kind) last.text += text;
    else tokens.push({ text, kind });
  };
  for (const m of line.matchAll(PATTERN)) {
    const [text = "", comment, directive, number, word] = m;
    if (comment) push(text, "comment");
    else if (directive) push(text, "directive");
    else if (number) push(text, "number");
    else if (word) {
      push(
        text,
        KEYWORDS.has(word)
          ? "keyword"
          : TYPES.has(word)
            ? "type"
            : BUILTINS.has(word)
              ? "builtin"
              : "plain",
      );
    } else push(text, "plain");
  }
  return tokens;
}

/** Re-indents code by its braces: two spaces per level, blank lines kept. */
export function tidy(code: string): string {
  let depth = 0;
  return code
    .split("\n")
    .map((raw) => {
      const line = raw.trim();
      if (line === "") return "";
      const opens = (line.replace(/\/\/.*$/, "").match(/\{/g) ?? []).length;
      const closes = (line.replace(/\/\/.*$/, "").match(/\}/g) ?? []).length;
      const leading = /^\}/.test(line) ? 1 : 0;
      const indent = Math.max(0, depth - leading);
      depth = Math.max(0, depth + opens - closes);
      return `${"  ".repeat(indent)}${line}`;
    })
    .join("\n");
}

/** The line and column (both 1 based) of a character position. */
export function lineAndColumn(code: string, position: number): { line: number; column: number } {
  const before = code.slice(0, position);
  const line = before.split("\n").length;
  return { line, column: position - (before.lastIndexOf("\n") + 1) + 1 };
}
