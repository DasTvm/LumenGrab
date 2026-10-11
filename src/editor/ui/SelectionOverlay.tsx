import type { Point } from "@/document/schema";
import { useEditor } from "./context";
import type { SelectController } from "./select-tool";
import { sizeLabel, type Grip } from "./selection";
import { toScreen, type Size, type View } from "./view";

interface Props {
  view: View;
  size: Size;
  controller: SelectController;
  showFrame: boolean;
  /** Changes when fonts finished loading: text sizes were measured with a fallback font before. */
  fontRev: number;
}

const HANDLE = 9;
const FRAME = "#18181b";
const GRIP = "#c8ff2e";

const pts = (points: readonly Point[]) =>
  points.map((p) => `${String(p.x)},${String(p.y)}`).join(" ");

/**
 * The selection on top of the canvas (design: selection handles): a thin frame, lime square handles,
 * the rotate handle on its stem, round handles on the ends and the bend of an arrow, and the size badge
 * while a box is resized. Drawn in screen pixels, so it stays crisp and the same size at any zoom.
 */
export function SelectionOverlay({ view, size, controller, showFrame, fontRev }: Props) {
  // Re-render with the document: layers moving or the selection changing.
  useEditor((s) => s.project);
  useEditor((s) => s.selection);
  const frame = showFrame ? controller.frame() : null;
  const marquee = controller.marquee;
  const resizing = controller.resizing;

  return (
    <svg
      aria-hidden
      className="pointer-events-none absolute inset-0"
      width={size.width}
      height={size.height}
      data-testid="selection-overlay"
      data-font-rev={fontRev}
    >
      {marquee ? (
        <rect
          x={toScreen(view, marquee).x}
          y={toScreen(view, marquee).y}
          width={marquee.width * view.zoom}
          height={marquee.height * view.zoom}
          fill="rgba(200, 255, 46, 0.12)"
          stroke={FRAME}
          strokeDasharray="4 3"
        />
      ) : null}
      {frame ? (
        <g data-testid="selection-frame" data-layer={frame.layerId ?? "many"}>
          <polygon
            points={pts(frame.corners.map((c) => toScreen(view, c)))}
            fill="none"
            stroke={FRAME}
            strokeWidth={1}
          />
          {frame.grips.map((grip) => (
            <GripShape key={gripKey(grip)} grip={grip} view={view} />
          ))}
          {resizing ? (
            <Badge label={sizeLabel(resizing)} frame={frame.corners} view={view} />
          ) : null}
        </g>
      ) : null}
    </svg>
  );
}

const gripKey = (grip: Grip): string =>
  grip.kind === "resize" ? grip.handle : grip.kind === "rotate" ? "rotate" : grip.which;

function GripShape({ grip, view }: { grip: Grip; view: View }) {
  const at = toScreen(view, grip.at);
  if (grip.kind === "resize") {
    return (
      <rect
        data-grip={grip.handle}
        x={at.x - HANDLE / 2}
        y={at.y - HANDLE / 2}
        width={HANDLE}
        height={HANDLE}
        rx={2}
        fill={GRIP}
        stroke={FRAME}
        strokeWidth={1.5}
      />
    );
  }
  if (grip.kind === "rotate") {
    const from = toScreen(view, grip.from);
    return (
      <g data-grip="rotate">
        <line x1={from.x} y1={from.y} x2={at.x} y2={at.y} stroke={FRAME} strokeWidth={1} />
        <circle cx={at.x} cy={at.y} r={8} fill={GRIP} stroke={FRAME} strokeWidth={1.5} />
        <path
          d={`M ${String(at.x - 3.2)} ${String(at.y - 1)} a 3.4 3.4 0 1 1 1 3.2 M ${String(at.x - 3.2)} ${String(at.y - 3.6)} v 2.6 h 2.6`}
          fill="none"
          stroke={FRAME}
          strokeWidth={1.4}
          strokeLinecap="round"
          strokeLinejoin="round"
        />
      </g>
    );
  }
  return (
    <circle
      data-grip={grip.which}
      cx={at.x}
      cy={at.y}
      r={5.5}
      fill={GRIP}
      stroke={FRAME}
      strokeWidth={1.5}
    />
  );
}

function Badge({ label, frame, view }: { label: string; frame: readonly Point[]; view: View }) {
  const bottom = frame.map((c) => toScreen(view, c));
  const x = bottom.reduce((sum, c) => sum + c.x, 0) / bottom.length;
  const y = Math.max(...bottom.map((c) => c.y)) + 12;
  const width = label.length * 6.4 + 14;
  return (
    <g data-testid="size-badge">
      <rect x={x - width / 2} y={y} width={width} height={18} rx={4} fill={FRAME} />
      <text
        x={x}
        y={y + 12.5}
        textAnchor="middle"
        fontSize={11}
        fontFamily="Inter Variable, system-ui, sans-serif"
        fill="#ffffff"
      >
        {label}
      </text>
    </g>
  );
}
