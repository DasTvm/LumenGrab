import { assembleCustom, checkCustomCode, parseCompileLog } from "./custom";
import { BLIT_FRAGMENT, COMPOSITE_FRAGMENT, VERTEX_SHADER } from "./glsl";
import { kindById, kindFragment } from "./kinds";
import { layerRole, phaseAt, posterSeconds, rgb01 } from "./scene";
import type { ShaderLayer, ShaderScene } from "./types";
import { builtinValues, compositeValues, customLayerValues, type UniformValues } from "./uniforms";

/**
 * Draws a shader background with WebGL 1 (docs/FORMAT.md section 4c). The scene is drawn pass by pass:
 * every layer is drawn into a texture, then laid over what is below it (blend mode, opacity); an effect
 * reads what is below it as `u_input`. The result is on the renderer's canvas, to be copied with `drawImage`.
 */

/** A frame of a layer that takes longer than this switches the layer off (the Studio asks the user to simplify it). */
export const HEAVY_FRAME_MS = 250;

export type LayerStatus =
  | { state: "ok"; compileMs?: number }
  | { state: "error"; message: string; line: number | null; usingLast: boolean }
  | { state: "too-long"; message: string }
  | { state: "skipped"; reason: "untrusted" | "unknown" | "empty" | "off" };

export interface RenderReport {
  /** Something was drawn. False when WebGL is not there or its context is lost. */
  drawn: boolean;
  lost: boolean;
  width: number;
  height: number;
  layers: Record<string, LayerStatus>;
  /** Milliseconds each measured layer took (only when `measure` was asked for). */
  layerMs: Record<string, number>;
  /** The layers that took longer than the limit. */
  heavy: string[];
}

export interface RenderOptions {
  /** Whether a layer with code may run (the trust gate). Default: yes. */
  allowCode?: (layer: ShaderLayer) => boolean;
  /** Time every layer (slower: it waits for the graphics card). */
  measure?: boolean;
}

interface Program {
  program: WebGLProgram;
  uniforms: Map<string, { location: WebGLUniformLocation; type: number; size: number }>;
}

interface Target {
  texture: WebGLTexture;
  framebuffer: WebGLFramebuffer;
}

const EMPTY: RenderReport = {
  drawn: false,
  lost: false,
  width: 0,
  height: 0,
  layers: {},
  layerMs: {},
  heavy: [],
};

export function webglAvailable(): boolean {
  if (typeof document === "undefined") return false;
  try {
    const canvas = document.createElement("canvas");
    const gl = canvas.getContext("webgl");
    gl?.getExtension("WEBGL_lose_context")?.loseContext();
    return gl !== null;
  } catch {
    return false;
  }
}

export class ShaderRenderer {
  readonly canvas: HTMLCanvasElement;
  private gl: WebGLRenderingContext | null = null;
  private lost = false;
  private quad: WebGLBuffer | null = null;
  private programs = new Map<string, Program | { error: string; line: number | null }>();
  private lastGood = new Map<string, string>();
  private targets: Target[] = [];
  private blank: Target | null = null;
  private size = { width: 0, height: 0 };
  private composite: Program | null = null;
  private blit: Program | null = null;
  private maxSize = 4096;

  constructor() {
    this.canvas = document.createElement("canvas");
    this.canvas.addEventListener("webglcontextlost", (event) => {
      event.preventDefault();
      this.lost = true;
    });
    this.canvas.addEventListener("webglcontextrestored", () => {
      this.reset();
      this.lost = false;
    });
  }

  /** The biggest picture this graphics card can draw on one side. */
  get maxEdge(): number {
    this.context();
    return this.maxSize;
  }

  private reset(): void {
    this.gl = null;
    this.quad = null;
    this.programs.clear();
    this.targets = [];
    this.blank = null;
    this.composite = null;
    this.blit = null;
    this.size = { width: 0, height: 0 };
  }

  private context(): WebGLRenderingContext | null {
    if (this.lost) return null;
    if (this.gl) return this.gl;
    let gl: WebGLRenderingContext | null;
    try {
      gl = this.canvas.getContext("webgl", {
        alpha: false,
        antialias: false,
        depth: false,
        stencil: false,
        premultipliedAlpha: false,
        preserveDrawingBuffer: false,
        powerPreference: "high-performance",
      });
    } catch {
      gl = null;
    }
    if (!gl) return null;
    this.gl = gl;
    this.maxSize = Math.min(
      8192,
      Number(gl.getParameter(gl.MAX_TEXTURE_SIZE)),
      Number(gl.getParameter(gl.MAX_RENDERBUFFER_SIZE)),
    );
    const quad = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, quad);
    gl.bufferData(
      gl.ARRAY_BUFFER,
      new Float32Array([-1, -1, 1, -1, -1, 1, -1, 1, 1, -1, 1, 1]),
      gl.STATIC_DRAW,
    );
    this.quad = quad;
    return gl;
  }

  private compile(
    gl: WebGLRenderingContext,
    fragment: string,
  ): Program | { error: string; line: number | null } {
    const vs = gl.createShader(gl.VERTEX_SHADER);
    const fs = gl.createShader(gl.FRAGMENT_SHADER);
    if (!vs || !fs) return { error: "The shader could not be created.", line: null };
    gl.shaderSource(vs, VERTEX_SHADER);
    gl.compileShader(vs);
    gl.shaderSource(fs, fragment);
    gl.compileShader(fs);
    if (!gl.getShaderParameter(fs, gl.COMPILE_STATUS)) {
      const log = gl.getShaderInfoLog(fs) ?? "";
      gl.deleteShader(vs);
      gl.deleteShader(fs);
      const parsed = parseCompileLog(log);
      return { error: parsed.message, line: parsed.line };
    }
    const program = gl.createProgram();
    gl.attachShader(program, vs);
    gl.attachShader(program, fs);
    gl.bindAttribLocation(program, 0, "a_pos");
    gl.linkProgram(program);
    gl.deleteShader(vs);
    gl.deleteShader(fs);
    if (!gl.getProgramParameter(program, gl.LINK_STATUS)) {
      const message = gl.getProgramInfoLog(program) ?? "The shader did not link.";
      gl.deleteProgram(program);
      return { error: message.trim(), line: null };
    }
    const uniforms: Program["uniforms"] = new Map();
    const count = Number(gl.getProgramParameter(program, gl.ACTIVE_UNIFORMS));
    for (let i = 0; i < count; i += 1) {
      const info = gl.getActiveUniform(program, i);
      if (!info) continue;
      const name = info.name.replace(/\[0\]$/, "");
      const location = gl.getUniformLocation(program, info.name);
      if (location) uniforms.set(name, { location, type: info.type, size: info.size });
    }
    return { program, uniforms };
  }

  private programFor(
    gl: WebGLRenderingContext,
    key: string,
    source: () => string,
  ): { program: Program | null; error: { error: string; line: number | null } | null; ms: number } {
    const cached = this.programs.get(key);
    if (cached)
      return "error" in cached
        ? { program: null, error: cached, ms: 0 }
        : { program: cached, error: null, ms: 0 };
    const start = performance.now();
    const built = this.compile(gl, source());
    this.programs.set(key, built);
    const ms = performance.now() - start;
    return "error" in built
      ? { program: null, error: built, ms }
      : { program: built, error: null, ms };
  }

  private target(gl: WebGLRenderingContext, width: number, height: number): Target {
    const texture = gl.createTexture();
    gl.bindTexture(gl.TEXTURE_2D, texture);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, width, height, 0, gl.RGBA, gl.UNSIGNED_BYTE, null);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    const framebuffer = gl.createFramebuffer();
    gl.bindFramebuffer(gl.FRAMEBUFFER, framebuffer);
    gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, texture, 0);
    return { texture, framebuffer };
  }

  private ensureTargets(gl: WebGLRenderingContext, width: number, height: number): void {
    if (this.targets.length === 3 && this.size.width === width && this.size.height === height)
      return;
    for (const t of [...this.targets, ...(this.blank ? [this.blank] : [])]) {
      gl.deleteTexture(t.texture);
      gl.deleteFramebuffer(t.framebuffer);
    }
    this.targets = [
      this.target(gl, width, height),
      this.target(gl, width, height),
      this.target(gl, width, height),
    ];
    this.blank = this.target(gl, 1, 1);
    gl.bindFramebuffer(gl.FRAMEBUFFER, this.blank.framebuffer);
    gl.viewport(0, 0, 1, 1);
    gl.clearColor(0, 0, 0, 1);
    gl.clear(gl.COLOR_BUFFER_BIT);
    this.size = { width, height };
  }

  private setUniforms(gl: WebGLRenderingContext, program: Program, values: UniformValues): void {
    for (const [name, value] of Object.entries(values)) {
      const u = program.uniforms.get(name);
      if (!u) continue;
      const list = Array.isArray(value) ? value : [value];
      switch (u.type) {
        case gl.FLOAT:
          if (u.size > 1) gl.uniform1fv(u.location, list);
          else gl.uniform1f(u.location, list[0] ?? 0);
          break;
        case gl.FLOAT_VEC2:
          gl.uniform2fv(u.location, list);
          break;
        case gl.FLOAT_VEC3:
          gl.uniform3fv(u.location, list);
          break;
        case gl.FLOAT_VEC4:
          gl.uniform4fv(u.location, list);
          break;
        case gl.INT:
        case gl.BOOL:
          gl.uniform1i(u.location, Math.round(list[0] ?? 0));
          break;
        default:
          break;
      }
    }
  }

  private bindTexture(
    gl: WebGLRenderingContext,
    program: Program,
    name: string,
    unit: number,
    texture: WebGLTexture,
  ): void {
    const u = program.uniforms.get(name);
    if (!u) return;
    gl.activeTexture(gl.TEXTURE0 + unit);
    gl.bindTexture(gl.TEXTURE_2D, texture);
    gl.uniform1i(u.location, unit);
  }

  private draw(
    gl: WebGLRenderingContext,
    target: Target | null,
    width: number,
    height: number,
  ): void {
    gl.bindFramebuffer(gl.FRAMEBUFFER, target ? target.framebuffer : null);
    gl.viewport(0, 0, width, height);
    gl.bindBuffer(gl.ARRAY_BUFFER, this.quad);
    gl.enableVertexAttribArray(0);
    gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 0, 0);
    gl.drawArrays(gl.TRIANGLES, 0, 6);
  }

  /** Waits for the graphics card (a one pixel read) and says how long it took since `since`. */
  private sync(gl: WebGLRenderingContext, since: number): number {
    gl.readPixels(0, 0, 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, new Uint8Array(4));
    return performance.now() - since;
  }

  /**
   * Draws `scene` at `seconds` into the canvas, `width` x `height` (made smaller if the graphics card
   * cannot do that size). Returns what happened to each layer.
   */
  render(
    scene: ShaderScene,
    seconds: number,
    width: number,
    height: number,
    options: RenderOptions = {},
  ): RenderReport {
    const gl = this.context();
    if (!gl) return { ...EMPTY, lost: this.lost };
    const limit = this.maxSize;
    const shrink = Math.min(1, limit / Math.max(width, height));
    const w = Math.max(1, Math.round(width * shrink));
    const h = Math.max(1, Math.round(height * shrink));
    if (this.canvas.width !== w || this.canvas.height !== h) {
      this.canvas.width = w;
      this.canvas.height = h;
    }
    this.ensureTargets(gl, w, h);
    const report: RenderReport = {
      drawn: false,
      lost: false,
      width: w,
      height: h,
      layers: {},
      layerMs: {},
      heavy: [],
    };

    const composite = (this.composite ??= this.compileOrNull(gl, COMPOSITE_FRAGMENT));
    const blit = (this.blit ??= this.compileOrNull(gl, BLIT_FRAGMENT));
    if (!composite || !blit) return report;

    const phase = phaseAt(scene, seconds);
    const canRun = options.allowCode ?? (() => true);
    let [acc, tmp, spare] = this.targets as [Target, Target, Target];

    gl.disable(gl.BLEND);
    const [fr, fg, fb] = rgb01(scene.fallback);
    gl.bindFramebuffer(gl.FRAMEBUFFER, acc.framebuffer);
    gl.viewport(0, 0, w, h);
    gl.clearColor(fr, fg, fb, 1);
    gl.clear(gl.COLOR_BUFFER_BIT);

    for (const layer of scene.layers) {
      if (!layer.enabled) {
        report.layers[layer.id] = { state: "skipped", reason: "off" };
        continue;
      }
      const role = layerRole(layer);
      if (role === null) {
        report.layers[layer.id] = { state: "skipped", reason: "unknown" };
        continue;
      }
      const isCustom = layer.kind === "custom";
      if (isCustom && (layer.code ?? "").length === 0) {
        report.layers[layer.id] = { state: "skipped", reason: "empty" };
        continue;
      }
      if (isCustom && !canRun(layer)) {
        report.layers[layer.id] = { state: "skipped", reason: "untrusted" };
        continue;
      }

      let program: Program | null = null;
      if (isCustom) {
        const code = layer.code ?? "";
        const check = checkCustomCode(code);
        const last = this.programs.get(`custom:${this.lastGood.get(layer.id) ?? "\0"}`);
        const lastProgram = last && !("error" in last) ? last : null;
        if (!check.ok) {
          report.layers[layer.id] = { state: "too-long", message: check.message };
          program = lastProgram;
        } else {
          const built = this.programFor(gl, `custom:${code}`, () => assembleCustom(code));
          if (built.program) {
            this.lastGood.set(layer.id, code);
            report.layers[layer.id] = { state: "ok", compileMs: built.ms };
            program = built.program;
          } else {
            const error = built.error ?? { error: "The shader did not compile.", line: null };
            report.layers[layer.id] = {
              state: "error",
              message: error.error,
              line: error.line,
              usingLast: lastProgram !== null,
            };
            program = lastProgram;
          }
        }
      } else {
        const kind = kindById(layer.kind);
        if (kind)
          program = this.programFor(gl, `kind:${kind.id}`, () => kindFragment(kind)).program;
        report.layers[layer.id] = { state: "ok" };
      }
      if (!program) continue;
      const started = performance.now();
      gl.useProgram(program.program);
      const kind = kindById(layer.kind);
      const values = isCustom
        ? customLayerValues(scene, layer, phase, w, h)
        : kind
          ? builtinValues(scene, layer, kind, phase, w, h)
          : {};
      this.setUniforms(gl, program, values);
      this.bindTexture(gl, program, "u_input", 0, acc.texture);
      this.draw(gl, tmp, w, h);

      gl.useProgram(composite.program);
      this.setUniforms(gl, composite, compositeValues(layer, role === "effect", w, h));
      this.bindTexture(gl, composite, "u_dst", 0, acc.texture);
      this.bindTexture(gl, composite, "u_src", 1, tmp.texture);
      this.draw(gl, spare, w, h);
      [acc, tmp, spare] = [spare, acc, tmp];

      if (options.measure && isCustom) {
        const ms = this.sync(gl, started);
        report.layerMs[layer.id] = ms;
        if (ms > HEAVY_FRAME_MS) report.heavy.push(layer.id);
      }
    }

    gl.useProgram(blit.program);
    this.setUniforms(gl, blit, { u_resolution: [w, h] });
    this.bindTexture(gl, blit, "u_tex", 0, acc.texture);
    this.draw(gl, null, w, h);
    report.drawn = true;
    return report;
  }

  private compileOrNull(gl: WebGLRenderingContext, fragment: string): Program | null {
    const built = this.compile(gl, fragment);
    return "error" in built ? null : built;
  }

  /** Tries to compile a custom shader without drawing: what the shader editor shows as it types. */
  tryCompile(
    code: string,
  ): { ok: true; ms: number } | { ok: false; message: string; line: number | null } {
    const gl = this.context();
    if (!gl) return { ok: false, message: "WebGL is not available.", line: null };
    const check = checkCustomCode(code);
    if (!check.ok) return { ok: false, message: check.message, line: check.line ?? null };
    const built = this.programFor(gl, `custom:${code}`, () => assembleCustom(code));
    if (built.program) return { ok: true, ms: built.ms };
    return {
      ok: false,
      message: built.error?.error ?? "The shader did not compile.",
      line: built.error?.line ?? null,
    };
  }

  /** Forgets compiled shaders of code that is gone (the editor makes a new one with every key press). */
  forget(keep: readonly string[]): void {
    const gl = this.gl;
    for (const [key, value] of this.programs) {
      if (!key.startsWith("custom:") || keep.includes(key.slice(7))) continue;
      if (gl && !("error" in value)) gl.deleteProgram(value.program);
      this.programs.delete(key);
    }
  }

  dispose(): void {
    this.gl?.getExtension("WEBGL_lose_context")?.loseContext();
    this.reset();
  }
}

const shared = new Map<string, ShaderRenderer>();

/** One renderer (and so one WebGL context) per purpose: the editor preview, stills and thumbnails each keep their own size. */
export function sharedRenderer(purpose: string): ShaderRenderer | null {
  const existing = shared.get(purpose);
  if (existing) return existing;
  if (!webglAvailable()) return null;
  const made = new ShaderRenderer();
  shared.set(purpose, made);
  return made;
}

/** A still: the scene at its poster moment, or at `seconds`. The canvas of the returned renderer holds the picture. */
export function renderStill(
  renderer: ShaderRenderer,
  scene: ShaderScene,
  width: number,
  height: number,
  seconds: number = posterSeconds(scene),
  options: RenderOptions = {},
): RenderReport {
  return renderer.render(scene, seconds, width, height, options);
}
