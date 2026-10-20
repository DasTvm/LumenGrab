import type { BlendMode } from "./types";

/**
 * The GLSL of the shader backgrounds (docs/FORMAT.md section 4c). Everything here is ours: the hash,
 * the noise and every look were written for LumenGrab. All of it is GLSL ES 1.00 (WebGL 1), the dialect
 * the shader editor teaches, so a built-in layer and a layer you write run the same way.
 *
 * Time reaches a shader as `u_a` (radians, `2 pi x speed x phase`, whole turns per loop) and `u_ph`
 * (`fract(speed x phase)`): every motion is built from whole turns of `u_a` or whole steps of `u_ph`,
 * so the picture at the end of the loop is exactly the picture at its start.
 */

export const VERTEX_SHADER = `attribute vec2 a_pos;
void main() { gl_Position = vec4(a_pos, 0.0, 1.0); }
`;

/** Our own helper functions. Each is named so a shader that defines `noise` itself does not clash. */
const HELPER_INTERNAL = `float lgHash(vec2 p) { return fract(sin(dot(p, vec2(41.3, 289.7))) * 17453.371); }
mat2 lgRot(float a) { float c = cos(a); float s = sin(a); return mat2(c, -s, s, c); }
float lgNoise(vec2 p) {
  vec2 i = floor(p);
  vec2 f = fract(p);
  vec2 u = f * f * (3.0 - 2.0 * f);
  return mix(mix(lgHash(i), lgHash(i + vec2(1.0, 0.0)), u.x),
             mix(lgHash(i + vec2(0.0, 1.0)), lgHash(i + vec2(1.0, 1.0)), u.x), u.y);
}
float lgFbm(vec2 p) {
  float s = 0.0;
  float a = 0.5;
  for (int i = 0; i < 5; i++) {
    s += a * lgNoise(p);
    p = lgRot(0.5) * p * 2.03 + vec2(11.7, 3.1);
    a *= 0.5;
  }
  return s;
}
vec3 lgHsv(vec3 c) {
  vec3 p = abs(fract(c.xxx + vec3(0.0, 2.0 / 3.0, 1.0 / 3.0)) * 6.0 - 3.0);
  return c.z * mix(vec3(1.0), clamp(p - 1.0, 0.0, 1.0), c.y);
}
`;

/** The helpers a custom shader may call, and the signature that tells whether the shader defines its own. */
export const PUBLIC_HELPERS: readonly { name: string; code: string }[] = [
  { name: "noise", code: "float noise(vec2 p) { return lgNoise(p); }\n" },
  { name: "fbm", code: "float fbm(vec2 p) { return lgFbm(p); }\n" },
  { name: "hsv2rgb", code: "vec3 hsv2rgb(vec3 c) { return lgHsv(c); }\n" },
  { name: "rot", code: "mat2 rot(float a) { return lgRot(a); }\n" },
];

/** The helpers to put in front of a custom shader: the internal ones, and each public one the code does not define itself. */
export function helperPrelude(userCode: string): string {
  const defined = (name: string) =>
    new RegExp(`\\b(?:float|vec2|vec3|vec4|mat2|mat3|mat4|void|int|bool)\\s+${name}\\s*\\(`).test(
      userCode,
    );
  return (
    HELPER_INTERNAL +
    PUBLIC_HELPERS.filter((h) => !defined(h.name))
      .map((h) => h.code)
      .join("")
  );
}

const PRECISION = `#ifdef GL_FRAGMENT_PRECISION_HIGH
precision highp float;
#else
precision mediump float;
#endif
`;

/** What every built-in layer can read. */
const BUILTIN_UNIFORMS = `uniform vec2 u_resolution;
uniform float u_phase;
uniform float u_seed;
uniform float u_a;
uniform float u_ph;
uniform float u_unit;
uniform float u_swap;
uniform vec3 u_lp[8];
uniform float u_lpn;
uniform sampler2D u_input;
`;

const BUILTIN_FUNCTIONS = `vec3 lpal(float i) {
  float n = max(u_lpn, 1.0);
  float idx = mod(floor(i), n);
  vec3 c = u_lp[0];
  for (int k = 1; k < 8; k++) { if (float(k) == idx) c = u_lp[k]; }
  return c;
}
vec3 lramp(float t) {
  float top = max(u_lpn - 1.0, 0.0);
  float x = clamp(t, 0.0, 1.0) * top;
  float i = floor(x);
  return mix(lpal(i), lpal(min(i + 1.0, top)), x - i);
}
vec2 circ(float a, float r) { return r * vec2(cos(a), sin(a)); }
vec2 centered() {
  vec2 c = (gl_FragCoord.xy - 0.5 * u_resolution) / min(u_resolution.x, u_resolution.y);
  return u_swap > 0.5 ? c.yx : c;
}
vec2 extent() {
  vec2 e = u_resolution / min(u_resolution.x, u_resolution.y);
  return u_swap > 0.5 ? e.yx : e;
}
float luma(vec3 c) { return dot(c, vec3(0.2126, 0.7152, 0.0722)); }
`;

/** The complete fragment shader of a built-in layer: the header, its settings as uniforms (colours are `vec3`), and its body. */
export function builtinFragment(
  uniforms: readonly { name: string; glsl: "float" | "vec3" }[],
  extra: string,
  body: string,
): string {
  const lines = uniforms.map((u) => `uniform ${u.glsl} ${u.name};`).join("\n");
  return `${PRECISION}${BUILTIN_UNIFORMS}${lines}\n${extra}\n${HELPER_INTERNAL}${BUILTIN_FUNCTIONS}${body}`;
}

// ---- generators ------------------------------------------------------------------------------

const GRADIENT_EXTRA = `uniform float u_stopN;
uniform float u_stopOff[8];
uniform vec4 u_stopCol[8];
vec4 stopColor(float t) {
  vec4 c = u_stopCol[0];
  for (int i = 1; i < 8; i++) {
    if (float(i) < u_stopN) {
      float a = u_stopOff[i - 1];
      float b = u_stopOff[i];
      vec4 m = mix(u_stopCol[i - 1], u_stopCol[i], clamp((t - a) / max(b - a, 0.0001), 0.0, 1.0));
      c = mix(c, m, step(a, t));
    }
  }
  return c;
}
`;

const GRADIENT_BODY = `void main() {
  vec2 r = u_resolution;
  vec2 p = gl_FragCoord.xy - 0.5 * r;
  float ang = radians(u_angle);
  float t = 0.0;
  if (u_type < 0.5) {
    float a = ang + u_a;
    vec2 d = vec2(sin(a), cos(a));
    float len = abs(r.x * d.x) + abs(r.y * d.y);
    t = dot(p, d) / max(len, 1.0) + 0.5;
  } else if (u_type < 1.5) {
    t = length(p) / (0.5 * length(r)) / (1.0 + 0.12 * sin(u_a));
  } else if (u_type < 2.5) {
    t = fract(atan(p.x, p.y) / 6.2831853 - (ang + u_a) / 6.2831853 + 1.0);
  } else {
    t = (abs(p.x) / (0.5 * r.x) + abs(p.y) / (0.5 * r.y)) * 0.5 / (1.0 + 0.12 * sin(u_a));
  }
  gl_FragColor = stopColor(clamp(t, 0.0, 1.0));
}
`;

const ORBS_BODY = `void main() {
  vec2 q = centered();
  vec2 ext = extent();
  vec3 col = vec3(0.0);
  float wsum = 0.0;
  for (int i = 0; i < 12; i++) {
    if (float(i) < u_count) {
      float fi = float(i);
      float sd = u_seed * 0.0137;
      float s1 = lgHash(vec2(fi, sd + 1.0));
      float s2 = lgHash(vec2(fi + 9.0, sd + 2.0));
      float s3 = lgHash(vec2(fi + 19.0, sd + 3.0));
      float s4 = lgHash(vec2(fi + 29.0, sd + 4.0));
      float k1 = 1.0 + floor(s3 * 2.0);
      float k2 = 1.0 + floor(s4 * 2.0);
      vec2 pos = (vec2(s1, s2) - 0.5) * ext * 0.9
        + u_spread * 0.35 * vec2(sin(u_a * k1 + s3 * 6.2831853), cos(u_a * k2 + s4 * 6.2831853));
      float rad = u_size * (0.3 + 0.45 * s3);
      vec2 dd = q - pos;
      float w = exp(-dot(dd, dd) / (rad * rad) * mix(9.0, 1.6, u_softness));
      col += lpal(fi) * w;
      wsum += w;
    }
  }
  gl_FragColor = vec4(col / max(wsum, 0.0001), 1.0 - exp(-wsum * 1.6));
}
`;

const AURORA_BODY = `void main() {
  vec2 q = centered();
  vec2 p = lgRot(radians(u_rotation)) * (q - vec2(u_offsetX, u_offsetY)) * u_scale;
  vec3 col = vec3(0.0);
  float acc = 0.0;
  for (int i = 0; i < 3; i++) {
    float fi = float(i);
    float w = sin(p.x * (1.2 + fi * 0.6) + u_a * (1.0 + fi) + fi * 2.1 + u_seed * 0.001) * 0.18
      + (lgNoise(vec2(p.x * 0.9 + fi * 5.3, fi * 3.7) + circ(u_a, 0.5)) - 0.5) * 0.5
      + (fi - 1.0) * 0.28;
    float d = p.y - w;
    float edge = exp(min(d, 0.0) * 13.0);
    float fade = exp(-max(d, 0.0) * 4.2);
    float rays = 0.55 + 0.45 * lgNoise(vec2(p.x * 4.5 + fi * 7.0, d * 1.2) + circ(u_a, 0.3));
    float v = edge * fade * rays;
    col += lpal(fi) * v;
    acc += v;
  }
  gl_FragColor = vec4(clamp(col / max(acc, 0.001), 0.0, 1.0), clamp(acc * 1.2, 0.0, 1.0));
}
`;

const WAVES_BODY = `void main() {
  vec2 q = lgRot(radians(u_rotation)) * centered();
  vec3 col = vec3(0.0);
  float cover = 0.0;
  float edge = mix(0.004, 0.12, u_softness);
  for (int i = 0; i < 12; i++) {
    if (float(i) < u_count) {
      float fi = float(i);
      float h = lgHash(vec2(fi, u_seed * 0.011));
      float f = u_frequency * (1.0 + 0.17 * fi);
      float base = mix(0.35, -0.45, fi / max(u_count - 1.0, 1.0));
      float wave = sin(q.x * f * 3.0 + u_a * (1.0 + mod(fi, 2.0)) + fi * 1.9 + h * 6.2831853) * u_amplitude * 0.2
        + sin(q.x * f * 1.7 - u_a + h * 11.0) * u_amplitude * 0.08;
      float cov = smoothstep(edge, -edge, q.y - (base + wave));
      col = col * (1.0 - cov) + lpal(fi) * cov;
      cover = cover + cov * (1.0 - cover);
    }
  }
  gl_FragColor = vec4(col / max(cover, 0.001), cover);
}
`;

const LIQUID_BODY = `float fbmN(vec2 p) {
  float s = 0.0;
  float a = 0.5;
  float total = 0.0;
  for (int i = 0; i < 5; i++) {
    if (float(i) < u_detail) {
      s += a * lgNoise(p);
      total += a;
      p = lgRot(0.5) * p * 2.03 + vec2(11.7, 3.1);
      a *= 0.5;
    }
  }
  return s / max(total, 0.0001);
}
void main() {
  vec2 p = lgRot(radians(u_rotation)) * centered() * u_scale + vec2(u_seed * 0.0007);
  vec2 w1 = circ(u_a, 0.6);
  vec2 a1 = vec2(fbmN(p + w1), fbmN(p + vec2(5.2, 1.3) - w1));
  vec2 p2 = p + u_warp * 2.0 * (a1 - 0.5);
  vec2 w2 = circ(u_a, 0.5);
  vec2 a2 = vec2(fbmN(p2 + vec2(1.7, 9.2) + w2), fbmN(p2 + vec2(8.3, 2.8) - w2));
  float t = fbmN(p2 + u_warp * 1.5 * (a2 - 0.5));
  gl_FragColor = vec4(lramp(smoothstep(0.15, 0.85, t)), 1.0);
}
`;

const CELLS_BODY = `void main() {
  vec2 p = centered() * u_scale + vec2(u_seed * 0.001);
  vec2 i = floor(p);
  vec2 f = fract(p);
  float d1 = 8.0;
  float d2 = 8.0;
  float id = 0.0;
  for (int y = -1; y <= 1; y++) {
    for (int x = -1; x <= 1; x++) {
      vec2 g = vec2(float(x), float(y));
      vec2 cell = i + g;
      float h = lgHash(cell);
      float h2 = lgHash(cell + 7.7);
      vec2 o = 0.5 + 0.5 * u_jitter * vec2(sin(u_a + 6.2831853 * h), cos(u_a + 6.2831853 * h2));
      vec2 r = g + o - f;
      float d = dot(r, r);
      if (d < d1) { d2 = d1; d1 = d; id = h; } else if (d < d2) { d2 = d; }
    }
  }
  vec3 col = lpal(floor(id * max(u_lpn, 1.0)));
  col *= mix(1.0, 0.55, u_softness * clamp(sqrt(d1) * 1.4, 0.0, 1.0));
  float edge = 1.0 - smoothstep(0.0, 0.06 + 0.1 * u_softness, sqrt(d2) - sqrt(d1));
  if (u_edges > 0.5) { gl_FragColor = vec4(lpal(0.0), edge); } else { gl_FragColor = vec4(col, 1.0); }
}
`;

const RIPPLES_BODY = `void main() {
  vec2 q = centered();
  vec2 c = (vec2(u_centerX, u_centerY) - 0.5) * extent();
  float d = length(q - c);
  float r = d / u_spacing - u_ph;
  float f = fract(r);
  float w = u_thickness * 0.5;
  float ring = 1.0 - smoothstep(w * 0.3, w + 0.001, abs(f - 0.5));
  float atten = exp(-d * u_fade * 3.0);
  gl_FragColor = vec4(lramp(fract(d * 0.8)), ring * atten);
}
`;

const PATTERN_BODY = `void main() {
  vec2 p = lgRot(radians(u_angle)) * centered() * u_scale;
  p.x += u_ph;
  float soft = u_softness * u_thickness;
  float m = 0.0;
  if (u_shape < 0.5) {
    float d = abs(fract(p.x) - 0.5) * 2.0;
    m = 1.0 - smoothstep(u_thickness - soft, u_thickness + 0.001, d);
  } else if (u_shape < 1.5) {
    vec2 d = abs(fract(p) - 0.5) * 2.0;
    float dm = min(d.x, d.y);
    m = 1.0 - smoothstep(u_thickness - soft, u_thickness + 0.001, dm);
  } else {
    float d = length(fract(p) - 0.5) * 2.0;
    m = 1.0 - smoothstep(u_thickness - soft, u_thickness + 0.001, d);
  }
  gl_FragColor = vec4(lpal(0.0), m);
}
`;

const RAYS_BODY = `void main() {
  vec2 q = centered();
  vec2 o = (vec2(u_originX, u_originY) - 0.5) * extent();
  vec2 v = q - o;
  float ang = atan(v.y, v.x) + sin(u_a) * 0.15;
  float s = abs(fract(ang / 6.2831853 * u_count) - 0.5) * 2.0;
  float ray = 1.0 - smoothstep(u_spread * (1.0 - u_softness), u_spread + 0.001, s);
  float len = length(v);
  float atten = exp(-len * u_falloff * 3.0);
  gl_FragColor = vec4(lramp(clamp(len * 0.6, 0.0, 1.0)), ray * atten * 0.9);
}
`;

const STARS_BODY = `void main() {
  vec2 q = centered();
  vec3 col = vec3(0.0);
  float a = 0.0;
  for (int l = 0; l < 2; l++) {
    float fl = float(l);
    vec2 p = q * (14.0 + fl * 18.0) + vec2(fl * 17.3 + u_seed * 0.001);
    p.x += sin(u_a + fl) * 0.4 * u_drift;
    vec2 cell = floor(p);
    vec2 f = fract(p) - 0.5;
    float h = lgHash(cell + fl * 3.1);
    float h2 = lgHash(cell + 5.7);
    float h3 = lgHash(cell + 11.3);
    float present = step(h, u_density * 0.5);
    vec2 jitter = (vec2(h2, h3) - 0.5) * 0.6;
    float rad = 0.1 * u_size * (0.5 + h2);
    float dist = length(f - jitter);
    float star = (smoothstep(rad, 0.0, dist) + 0.35 * smoothstep(rad * 3.5, 0.0, dist)) * present;
    float tw = 1.0 - u_twinkle * 0.5 * (1.0 + sin(u_a * (1.0 + floor(h3 * 3.0)) + h * 6.2831853));
    float v = star * tw;
    col += lramp(h2) * v;
    a = max(a, v);
  }
  gl_FragColor = vec4(col / max(a, 0.001), clamp(a, 0.0, 1.0));
}
`;

const SOLID_BODY = `void main() { gl_FragColor = vec4(u_color, 1.0); }
`;

// ---- effects -----------------------------------------------------------------------------------

const EFFECT_UV = `vec2 uv() { return gl_FragCoord.xy / u_resolution; }
vec4 src(vec2 p) { return texture2D(u_input, clamp(p, 0.0, 1.0)); }
`;

const WARP_BODY = `void main() {
  vec2 p = uv();
  vec2 c = centered() * u_scale;
  vec2 w = circ(u_a, 0.8);
  vec2 d = vec2(lgFbm(c + w), lgFbm(c + vec2(7.3, 2.9) - w)) - 0.5;
  gl_FragColor = vec4(src(p + d * u_amount * 0.2).rgb, 1.0);
}
`;

const SWIRL_BODY = `void main() {
  vec2 q = centered();
  vec2 c = (vec2(u_centerX, u_centerY) - 0.5) * extent();
  vec2 v = q - c;
  float d = length(v) / max(u_radius, 0.01);
  float k = max(0.0, 1.0 - d);
  float ang = u_amount * 6.2831853 * k * k * cos(u_a);
  vec2 r = lgRot(ang) * v + c;
  vec2 p = r / extent() + 0.5;
  gl_FragColor = vec4(src(p).rgb, 1.0);
}
`;

const CHROMATIC_BODY = `void main() {
  vec2 p = uv();
  float ang = radians(u_angle);
  vec2 off = vec2(cos(ang), sin(ang)) * u_amount * u_unit / u_resolution * (1.0 + 0.5 * sin(u_a));
  gl_FragColor = vec4(src(p + off).r, src(p).g, src(p - off).b, 1.0);
}
`;

const PIXELATE_BODY = `void main() {
  float cell = max(u_size * u_unit * (u_animate > 0.5 ? 1.0 + 0.35 * sin(u_a) : 1.0), 1.0);
  vec2 cells = u_square > 0.5 ? vec2(cell) : u_resolution / max(floor(u_resolution.y / cell), 1.0);
  vec2 qc = (floor(gl_FragCoord.xy / cells) + 0.5) * cells / u_resolution;
  vec3 a = src(uv()).rgb;
  vec3 b = src(qc).rgb;
  gl_FragColor = vec4(mix(a, b, u_amount), 1.0);
}
`;

const POSTERIZE_BODY = `void main() {
  vec3 c = src(uv()).rgb;
  vec3 p = floor(c * u_levels + 0.5) / u_levels;
  gl_FragColor = vec4(mix(c, p, u_amount), 1.0);
}
`;

const VIGNETTE_BODY = `void main() {
  vec3 c = src(uv()).rgb;
  vec2 p = (gl_FragCoord.xy / u_resolution - 0.5) * 2.0;
  vec2 round = p * u_resolution / max(u_resolution.x, u_resolution.y);
  float d = length(mix(round, p, u_roundness));
  float v = smoothstep(max(0.0, 0.9 - u_softness * 0.9), 1.45, d);
  gl_FragColor = vec4(c * (1.0 - u_amount * v), 1.0);
}
`;

const GRAIN_BODY = `void main() {
  vec3 c = src(uv()).rgb;
  float size = max(u_size * u_unit, 1.0);
  float frame = u_animate > 0.5 ? floor(u_ph * 12.0) : 0.0;
  vec2 cell = floor(gl_FragCoord.xy / size);
  float n = lgHash(cell + vec2(frame * 13.7, u_seed * 0.01 + frame * 3.1));
  float tone = 1.0 - abs(luma(c) - 0.5) * 0.6;
  gl_FragColor = vec4(clamp(c + (n - 0.5) * u_amount * 0.7 * tone, 0.0, 1.0), 1.0);
}
`;

const GLOW_BODY = `void main() {
  vec2 p = uv();
  vec3 c = src(p).rgb;
  vec3 bloom = vec3(0.0);
  float r1 = u_radius;
  float r2 = u_radius * 2.2;
  for (int i = 0; i < 8; i++) {
    float a = float(i) * 0.785398;
    vec2 d = vec2(cos(a), sin(a)) * vec2(1.0, u_resolution.x / u_resolution.y);
    bloom += max(src(p + d * r1).rgb - u_threshold, 0.0);
    bloom += max(src(p + d * r2).rgb - u_threshold, 0.0) * 0.6;
  }
  bloom += max(c - u_threshold, 0.0);
  gl_FragColor = vec4(c + bloom / 9.0 * u_intensity * 2.0, 1.0);
}
`;

const GRADE_BODY = `void main() {
  vec3 c = src(uv()).rgb;
  c += u_brightness / 100.0 * 0.5;
  c = (c - 0.5) * (1.0 + u_contrast / 100.0) + 0.5;
  float l = luma(c);
  c = mix(vec3(l), c, u_saturation);
  float h = radians(u_hue);
  float cs = cos(h);
  float sn = sin(h);
  mat3 m = mat3(
    0.299 + 0.701 * cs + 0.168 * sn, 0.587 - 0.587 * cs + 0.330 * sn, 0.114 - 0.114 * cs - 0.497 * sn,
    0.299 - 0.299 * cs - 0.328 * sn, 0.587 + 0.413 * cs + 0.035 * sn, 0.114 - 0.114 * cs + 0.292 * sn,
    0.299 - 0.300 * cs + 1.250 * sn, 0.587 - 0.588 * cs - 1.050 * sn, 0.114 + 0.886 * cs - 0.203 * sn);
  c = c * m;
  c = mix(c, u_tint * (0.35 + luma(c) * 0.9), u_tintAmount);
  gl_FragColor = vec4(clamp(c, 0.0, 1.0), 1.0);
}
`;

/** `extra` (declarations that come before the helpers) and `body` of each built-in kind. */
export const KIND_SHADERS: Record<string, { extra: string; body: string }> = {
  gradient: { extra: GRADIENT_EXTRA, body: GRADIENT_BODY },
  orbs: { extra: "", body: ORBS_BODY },
  aurora: { extra: "", body: AURORA_BODY },
  waves: { extra: "", body: WAVES_BODY },
  liquid: { extra: "", body: LIQUID_BODY },
  cells: { extra: "", body: CELLS_BODY },
  ripples: { extra: "", body: RIPPLES_BODY },
  pattern: { extra: "", body: PATTERN_BODY },
  rays: { extra: "", body: RAYS_BODY },
  stars: { extra: "", body: STARS_BODY },
  solid: { extra: "", body: SOLID_BODY },
  warp: { extra: EFFECT_UV, body: WARP_BODY },
  swirl: { extra: EFFECT_UV, body: SWIRL_BODY },
  chromatic: { extra: EFFECT_UV, body: CHROMATIC_BODY },
  pixelate: { extra: EFFECT_UV, body: PIXELATE_BODY },
  posterize: { extra: EFFECT_UV, body: POSTERIZE_BODY },
  vignette: { extra: EFFECT_UV, body: VIGNETTE_BODY },
  grain: { extra: EFFECT_UV, body: GRAIN_BODY },
  glow: { extra: EFFECT_UV, body: GLOW_BODY },
  grade: { extra: EFFECT_UV, body: GRADE_BODY },
};

// ---- composition -------------------------------------------------------------------------------

export const BLEND_INDEX: Record<BlendMode, number> = {
  normal: 0,
  add: 1,
  screen: 2,
  multiply: 3,
  overlay: 4,
  "soft-light": 5,
};

/** Lays the result of a layer over what is below it. The picture below is always opaque. */
export const COMPOSITE_FRAGMENT = `${PRECISION}uniform sampler2D u_dst;
uniform sampler2D u_src;
uniform vec2 u_resolution;
uniform float u_opacity;
uniform float u_mode;
uniform float u_opaque;
vec3 blendColors(vec3 d, vec3 s, float m) {
  if (m < 0.5) return s;
  if (m < 1.5) return min(d + s, 1.0);
  if (m < 2.5) return 1.0 - (1.0 - d) * (1.0 - s);
  if (m < 3.5) return d * s;
  if (m < 4.5) return mix(2.0 * d * s, 1.0 - 2.0 * (1.0 - d) * (1.0 - s), step(0.5, d));
  vec3 dd = mix(sqrt(d), ((16.0 * d - 12.0) * d + 4.0) * d, step(d, vec3(0.25)));
  return mix(d - (1.0 - 2.0 * s) * d * (1.0 - d), d + (2.0 * s - 1.0) * (dd - d), step(0.5, s));
}
void main() {
  vec2 uv = gl_FragCoord.xy / u_resolution;
  vec3 d = texture2D(u_dst, uv).rgb;
  vec4 s = texture2D(u_src, uv);
  gl_FragColor = vec4(mix(d, blendColors(d, s.rgb, u_mode), clamp(mix(s.a, 1.0, u_opaque) * u_opacity, 0.0, 1.0)), 1.0);
}
`;

/** Puts the finished picture on the canvas. */
export const BLIT_FRAGMENT = `${PRECISION}uniform sampler2D u_tex;
uniform vec2 u_resolution;
void main() { gl_FragColor = vec4(texture2D(u_tex, gl_FragCoord.xy / u_resolution).rgb, 1.0); }
`;
