import { useStores, useUi } from "./context";
import { inSource } from "./text-read";
import { toScreen, type Size, type View } from "./view";

/**
 * The boxes of the read text on top of the picture (design: "M6 / Editor text"): every block outlined,
 * the picked ones filled, the QR codes marked. Drawn in screen pixels like the selection handles.
 */
export function TextOverlay({ view, size }: { view: View; size: Size }) {
  const { ui } = useStores();
  const text = useUi((s) => s.text);
  if (text?.status !== "done") return null;

  const box = (b: { x: number; y: number; width: number; height: number }) => {
    const r = inSource(b, text.origin);
    const at = toScreen(view, r);
    return { x: at.x, y: at.y, width: r.width * view.zoom, height: r.height * view.zoom };
  };

  return (
    <svg
      className="pointer-events-none absolute inset-0"
      width={size.width}
      height={size.height}
      aria-label="Text on the picture"
      data-testid="text-overlay"
    >
      {text.result.blocks.map((block, i) => {
        const on = text.selected.includes(i);
        const r = box(block);
        return (
          <rect
            key={`${String(i)}-${block.text}`}
            data-testid="text-box"
            data-selected={on}
            x={r.x - 2}
            y={r.y - 2}
            width={r.width + 4}
            height={r.height + 4}
            rx={3}
            fill={on ? "rgb(200 255 46 / 0.35)" : "rgb(200 255 46 / 0.08)"}
            stroke={on ? "#18181b" : "#c8ff2e"}
            strokeWidth={on ? 2 : 1.5}
            className="pointer-events-auto cursor-pointer"
            onPointerDown={(e) => {
              // The picture's own tools must not start a drawing under a click on a block.
              e.stopPropagation();
            }}
            onClick={() => {
              ui.getState().toggleTextBlock(i);
            }}
          />
        );
      })}
      {text.result.codes.map((code, i) => {
        const r = box(code);
        return (
          <g key={`${String(i)}-${code.value}`} data-testid="code-box">
            <rect
              x={r.x - 3}
              y={r.y - 3}
              width={r.width + 6}
              height={r.height + 6}
              rx={4}
              fill="rgb(24 24 27 / 0.08)"
              stroke="#18181b"
              strokeWidth={2}
            />
            <rect
              x={r.x - 3}
              y={r.y - 22}
              width={text.result.codes.length > 1 ? 40 : 30}
              height={18}
              rx={4}
              fill="#18181b"
            />
            <text x={r.x + 3} y={r.y - 9} fontSize={11} fontWeight={600} fill="#c8ff2e">
              {text.result.codes.length > 1 ? `QR ${String(i + 1)}` : "QR"}
            </text>
          </g>
        );
      })}
    </svg>
  );
}
