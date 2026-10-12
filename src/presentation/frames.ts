import type { Ctx2D } from "@/editor/draw/draw";
import { fontString } from "@/editor/draw/text";
import type { Presentation } from "@/document/schema";

/**
 * The window frames, drawn in code (no artwork of anyone else), docs/FORMAT.md section 4b. Every length
 * is `k` times the value at a content width of 1280 px; the colours are fixed so an old file looks the
 * same later.
 */
type Frame = Presentation["frame"];

interface Palette {
  bar: string;
  line: string;
  text: string;
  field: string;
  dot: string;
}

const LIGHT: Palette = {
  bar: "#F2F2F4",
  line: "#D9D9DE",
  text: "#4B5563",
  field: "#FFFFFF",
  dot: "#C7C7CC",
};
const DARK: Palette = {
  bar: "#2A2A2E",
  line: "#3A3A40",
  text: "#A1A1AA",
  field: "#1B1B1E",
  dot: "#55555B",
};
const TERMINAL: Palette = {
  bar: "#1F1F23",
  line: "#34343A",
  text: "#A1A1AA",
  field: "#1B1B1E",
  dot: "#55555B",
};
const TRAFFIC = ["#FF5F57", "#FEBC2E", "#28C840"];

export function paletteOf(frame: Frame): Palette {
  if (frame.type === "terminal") return TERMINAL;
  return frame.theme === "dark" ? DARK : LIGHT;
}

/** The fonts the frame text needs, for `document.fonts.load`. */
export function frameFonts(frame: Frame): string[] {
  if (frame.type === "terminal") return [fontString("jetbrains-mono", 400, 16)];
  if (frame.type === "none" || frame.type === "minimal") return [];
  return [fontString("inter", 500, 16)];
}

function circle(ctx: Ctx2D, x: number, y: number, r: number, fill: string): void {
  ctx.beginPath();
  ctx.arc(x, y, r, 0, Math.PI * 2);
  ctx.fillStyle = fill;
  ctx.fill();
}

function fitText(ctx: Ctx2D, text: string, maxWidth: number): string {
  if (ctx.measureText(text).width <= maxWidth) return text;
  let cut = text.length;
  while (cut > 1 && ctx.measureText(`${text.slice(0, cut)}…`).width > maxWidth) cut -= 1;
  return `${text.slice(0, cut)}…`;
}

/**
 * Draws the title bar into the box `x, y, width, bar` (the caller has clipped to the rounded window).
 * The bottom edge gets a hairline between bar and picture.
 */
export function drawFrameChrome(
  ctx: Ctx2D,
  frame: Frame,
  box: { x: number; y: number; width: number; bar: number },
  k: number,
): void {
  if (frame.type === "none" || box.bar <= 0) return;
  const palette = paletteOf(frame);
  const { x, y, width, bar } = box;
  const midY = y + bar / 2;
  ctx.save();
  ctx.fillStyle = palette.bar;
  ctx.fillRect(x, y, width, bar);
  ctx.fillStyle = palette.line;
  ctx.fillRect(x, y + bar - Math.max(1, k), width, Math.max(1, k));
  ctx.textBaseline = "middle";

  if (frame.type === "macos-window" || frame.type === "terminal") {
    TRAFFIC.forEach((c, i) => {
      circle(ctx, x + (20 + i * 20) * k, midY, 6 * k, c);
    });
    const title = frame.title ?? "";
    if (title) {
      ctx.font =
        frame.type === "terminal"
          ? fontString("jetbrains-mono", 400, 12 * k)
          : fontString("inter", 500, 13 * k);
      ctx.fillStyle = palette.text;
      ctx.textAlign = "center";
      ctx.fillText(fitText(ctx, title, width - 160 * k), x + width / 2, midY);
    }
  } else if (frame.type === "windows-window") {
    const title = frame.title ?? "";
    if (title) {
      ctx.font = fontString("inter", 500, 12 * k);
      ctx.fillStyle = palette.text;
      ctx.textAlign = "left";
      ctx.fillText(fitText(ctx, title, width - 180 * k), x + 14 * k, midY);
    }
    ctx.strokeStyle = palette.text;
    ctx.lineWidth = Math.max(1, k);
    const g = 5 * k;
    const cx = (n: number) => x + width - (n + 0.5) * 46 * k;
    ctx.beginPath();
    ctx.moveTo(cx(2) - g, midY);
    ctx.lineTo(cx(2) + g, midY);
    ctx.stroke();
    ctx.strokeRect(cx(1) - g, midY - g, 2 * g, 2 * g);
    ctx.beginPath();
    ctx.moveTo(cx(0) - g, midY - g);
    ctx.lineTo(cx(0) + g, midY + g);
    ctx.moveTo(cx(0) + g, midY - g);
    ctx.lineTo(cx(0) - g, midY + g);
    ctx.stroke();
  } else if (frame.type === "browser") {
    TRAFFIC.forEach((c, i) => {
      circle(ctx, x + (20 + i * 20) * k, midY, 5 * k, c);
    });
    const fieldX = x + 96 * k;
    const fieldW = width - 192 * k;
    const text = frame.url || frame.title || "";
    if (fieldW >= 120 * k) {
      const h = 28 * k;
      ctx.beginPath();
      ctx.roundRect(fieldX, midY - h / 2, fieldW, h, 14 * k);
      ctx.fillStyle = palette.field;
      ctx.fill();
      if (text) {
        ctx.font = fontString("inter", 400, 13 * k);
        ctx.fillStyle = palette.text;
        ctx.textAlign = "center";
        ctx.fillText(fitText(ctx, text, fieldW - 28 * k), fieldX + fieldW / 2, midY);
      }
    }
  } else {
    for (let i = 0; i < 3; i += 1) circle(ctx, x + (14 + i * 14) * k, midY, 4 * k, palette.dot);
  }
  ctx.restore();
}
