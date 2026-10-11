import { Crop } from "lucide-react";
import { HANDLES } from "../model/geometry";
import { useUi } from "./context";
import { handlePoint } from "./selection";
import { toScreen, type Size, type View } from "./view";

const FRAME = "#18181b";
const GRIP = "#c8ff2e";

/**
 * The crop frame on the picture (design: Crop mode): the part that will go is dimmed, the frame has a
 * rule-of-thirds grid and eight handles, and a badge under it names the size.
 */
export function CropOverlay({ view, size }: { view: View; size: Size }) {
  const draft = useUi((s) => s.crop);
  const image = useUi((s) => s.imageSize);
  if (!draft) return null;
  const { rect } = draft;
  const a = toScreen(view, rect);
  const w = rect.width * view.zoom;
  const h = rect.height * view.zoom;
  const origin = toScreen(view, { x: 0, y: 0 });
  const iw = image.width * view.zoom;
  const ih = image.height * view.zoom;
  const label = `${String(rect.width)} × ${String(rect.height)}`;
  const badgeW = label.length * 6.6 + 34;
  const badgeY = a.y + h + 12 + 21 > size.height ? a.y + h - 33 : a.y + h + 12;

  return (
    <svg
      aria-hidden
      className="pointer-events-none absolute inset-0"
      width={size.width}
      height={size.height}
      data-testid="crop-overlay"
    >
      <path
        data-testid="crop-dim"
        fillRule="evenodd"
        fill="rgba(9, 9, 11, 0.6)"
        d={`M${String(origin.x)} ${String(origin.y)}h${String(iw)}v${String(ih)}h${String(-iw)}Z M${String(a.x)} ${String(a.y)}h${String(w)}v${String(h)}h${String(-w)}Z`}
      />
      <g stroke="rgba(255,255,255,0.45)" strokeWidth={1}>
        {[1, 2].map((i) => (
          <g key={i}>
            <line x1={a.x + (w * i) / 3} y1={a.y} x2={a.x + (w * i) / 3} y2={a.y + h} />
            <line x1={a.x} y1={a.y + (h * i) / 3} x2={a.x + w} y2={a.y + (h * i) / 3} />
          </g>
        ))}
      </g>
      <rect x={a.x} y={a.y} width={w} height={h} fill="none" stroke="#ffffff" strokeWidth={1.5} />
      {HANDLES.map((handle) => {
        const p = toScreen(view, handlePoint(rect, 0, handle));
        return (
          <rect
            key={handle}
            data-grip={handle}
            x={p.x - 4.5}
            y={p.y - 4.5}
            width={9}
            height={9}
            rx={2}
            fill={GRIP}
            stroke={FRAME}
            strokeWidth={1.5}
          />
        );
      })}
      <g
        data-testid="crop-badge"
        transform={`translate(${String(a.x + w / 2 - badgeW / 2)} ${String(badgeY)})`}
      >
        <rect width={badgeW} height={21} rx={4} fill={FRAME} />
        <Crop x={9} y={5} width={11} height={11} stroke={GRIP} strokeWidth={2} />
        <text
          x={26}
          y={14.5}
          fontSize={11}
          fill="#ffffff"
          fontFamily="Inter Variable, system-ui, sans-serif"
        >
          {label}
        </text>
      </g>
    </svg>
  );
}
