import { useEffect, useRef } from "react";
import { fontString, BACKGROUND_PADDING } from "../draw/text";
import { measureTextLayer } from "../draw/text-measure";
import { cssColor } from "../draw/color";
import { findLayer } from "../model/tree";
import { useEditor, useStores, useUi } from "./context";
import { finishEditing, setText, setTextWidth, textOf } from "./text-edit";
import { toScreen, type View } from "./view";

/** Room for the caret at the end of a line, in image pixels at 100 %. */
const CARET_ROOM = 3;

/**
 * The text field on the picture (design: Text editing in place). It sits exactly where the text is
 * drawn, in the same font and size, so typing looks like the finished text; the handle on the right
 * edge sets the width (lines then wrap inside it). Esc or a click outside ends it; a text box that
 * stays empty disappears again.
 */
export function TextEditor({ view }: { view: View }) {
  const { editor, ui } = useStores();
  const editing = useUi((s) => s.editing);
  const layer = useEditor((s) => (editing ? findLayer(s.project.layers, editing.id) : null));
  const field = useRef<HTMLTextAreaElement>(null);

  const id = editing?.id;
  useEffect(() => {
    const el = field.current;
    if (!el) return;
    el.focus();
    el.setSelectionRange(el.value.length, el.value.length);
  }, [id]);

  if (!editing || !layer || layer.type !== "text") return null;
  const size = Number(layer["size"]);
  const zoom = view.zoom;
  const origin = toScreen(view, { x: Number(layer["x"]), y: Number(layer["y"]) });
  const measured = measureTextLayer(layer);
  const fixed = typeof layer["width"] === "number";
  const pad = size * BACKGROUND_PADDING * zoom;
  const width = fixed ? Number(layer["width"]) : Math.max(measured.width + CARET_ROOM, 140 / zoom);
  const background = typeof layer["background"] === "string" ? layer["background"] : null;
  const color = String(layer["color"]);
  const rotation = Number(layer["rotation"] ?? 0);
  const text = textOf(layer);
  // The field is one line taller than needed so a trailing line break does not scroll it.
  const height = Math.max(measured.height, size * 1.3);

  return (
    <div
      data-testid="text-editor"
      className="absolute"
      style={{
        left: origin.x - pad,
        top: origin.y - pad,
        transform: rotation ? `rotate(${String(rotation)}deg)` : undefined,
        transformOrigin: "center",
      }}
      onPointerDown={(e) => {
        e.stopPropagation();
      }}
      onPointerMove={(e) => {
        e.stopPropagation();
      }}
      onPointerUp={(e) => {
        e.stopPropagation();
      }}
    >
      <textarea
        ref={field}
        aria-label="Text"
        value={text}
        placeholder="Type something…"
        spellCheck={false}
        wrap={fixed ? "soft" : "off"}
        rows={1}
        className="block resize-none overflow-hidden rounded-[2px] border-0 outline-[1.5px] outline-offset-0 outline-[#18181b] placeholder:opacity-40"
        style={{
          width: width * zoom + 2 * pad,
          height: height * zoom + 2 * pad,
          padding: pad,
          font: fontString(String(layer["fontId"]), Number(layer["weight"]), size * zoom),
          lineHeight: 1.3,
          textAlign: String(layer["align"]) as "left" | "center" | "right",
          color: cssColor(color),
          background: background ? cssColor(background) : "rgba(255,255,255,0.01)",
        }}
        onChange={(e) => {
          setText(editor, editing.id, e.target.value);
        }}
        onKeyDown={(e) => {
          e.stopPropagation();
          if (e.key === "Escape" || (e.key === "Enter" && (e.metaKey || e.ctrlKey))) {
            e.preventDefault();
            finishEditing(editor, ui);
          }
        }}
        onBlur={() => {
          finishEditing(editor, ui);
        }}
      />
      <span
        data-grip="text-width"
        role="slider"
        aria-label="Text width"
        aria-valuenow={Math.round(width)}
        aria-valuemin={20}
        tabIndex={-1}
        className="absolute top-1/2 -right-[5px] size-[9px] -translate-y-1/2 cursor-ew-resize rounded-[2px] border-[1.5px] border-[#18181b] bg-[#c8ff2e]"
        onPointerDown={(e) => {
          e.preventDefault();
          e.currentTarget.setPointerCapture(e.pointerId);
        }}
        onPointerMove={(e) => {
          if (!e.currentTarget.hasPointerCapture(e.pointerId)) return;
          const parent = e.currentTarget.parentElement?.getBoundingClientRect();
          if (!parent) return;
          // Left edge of the text block on the screen, then back to image pixels.
          const blockLeft = parent.left + pad;
          setTextWidth(editor, editing.id, (e.clientX - blockLeft) / zoom);
        }}
        onPointerUp={(e) => {
          e.currentTarget.releasePointerCapture(e.pointerId);
          field.current?.focus();
        }}
      />
    </div>
  );
}
