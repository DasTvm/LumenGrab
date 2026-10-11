import { ArrowDown, ArrowUp, Copy, MousePointerClick, Trash2 } from "lucide-react";
import { Button } from "@/ui/components/button";
import { findLayer } from "../model/tree";
import { useEditor, useStores, useUi } from "./context";
import { TOOL_ICONS } from "./icons";
import { isStyleTool, type StyleTool } from "../model/bindings";
import { ToolPanelBody } from "./ToolPanels";
import { toolById, toolForLayerType, type ToolId } from "./tools";

/**
 * The Style tab (design: tool options): the title with the tool badge and shortcut, a caption saying
 * whether it edits the defaults of new layers or the selected one, the options, and the object actions.
 */
export function StylePanel({ readOnly }: { readOnly: boolean }) {
  const { editor } = useStores();
  const tool = useUi((s) => s.tool);
  const layers = useEditor((s) => s.project.layers);
  const selection = useEditor((s) => s.selection);
  const picked = selection.map((id) => findLayer(layers, id)).filter((l) => l !== null);
  const kinds = new Set(picked.map((l) => toolForLayerType(l.type)));
  // One kind of layer selected: its options. Nothing selected: the active tool's defaults.
  const layerTool = kinds.size === 1 ? ([...kinds][0] ?? null) : null;
  const shown: StyleTool | null =
    layerTool && isStyleTool(layerTool)
      ? layerTool
      : picked.length === 0 && isStyleTool(tool)
        ? tool
        : null;
  const count = selection.length;

  return (
    <div className="flex min-h-0 flex-1 flex-col" data-testid="style-panel">
      {shown ? (
        <>
          <PanelTitle tool={shown} selected={picked.length > 0} count={picked.length} />
          <fieldset
            disabled={readOnly}
            // The side padding is room for the selection rings: a scroll container clips whatever sticks out of it.
            className="-mx-2 flex min-h-0 flex-1 flex-col gap-4 overflow-y-auto px-2 pt-4 pb-2"
          >
            <ToolPanelBody tool={shown} />
          </fieldset>
        </>
      ) : (
        <div className="flex flex-1 flex-col items-center justify-center gap-3 px-6 text-center">
          <span className="flex size-11 items-center justify-center rounded-full bg-muted text-muted-foreground">
            <MousePointerClick aria-hidden className="size-5" />
          </span>
          <p className="text-sm font-medium">
            {count > 1
              ? `${String(count)} layers selected`
              : count === 1
                ? "Group selected"
                : "Nothing selected"}
          </p>
          <p className="text-[13px] text-muted-foreground">
            {count > 0
              ? "Move them together, or open the Layers tab to group, hide or lock."
              : "Click an annotation to change its style, or pick a tool to start drawing."}
          </p>
        </div>
      )}
      {count > 0 && !readOnly ? (
        <div
          className="flex items-center gap-1 border-t border-border pt-2"
          role="toolbar"
          aria-label="Object actions"
        >
          <Button
            variant="ghost"
            size="icon"
            className="size-8"
            aria-label="Duplicate"
            onClick={() => {
              editor.getState().duplicateLayers();
            }}
          >
            <Copy aria-hidden />
          </Button>
          <Button
            variant="ghost"
            size="icon"
            className="size-8"
            aria-label="Bring forward"
            onClick={() => {
              editor.getState().reorder("forward");
            }}
          >
            <ArrowUp aria-hidden />
          </Button>
          <Button
            variant="ghost"
            size="icon"
            className="size-8"
            aria-label="Send backward"
            onClick={() => {
              editor.getState().reorder("backward");
            }}
          >
            <ArrowDown aria-hidden />
          </Button>
          <span className="flex-1" />
          <Button
            variant="ghost"
            size="icon"
            className="size-8"
            aria-label="Delete"
            onClick={() => {
              editor.getState().deleteLayers();
            }}
          >
            <Trash2 aria-hidden />
          </Button>
        </div>
      ) : null}
    </div>
  );
}

function PanelTitle({ tool, selected, count }: { tool: ToolId; selected: boolean; count: number }) {
  const info = toolById(tool);
  const Icon = TOOL_ICONS[tool];
  const noun = info.label.toLowerCase();
  return (
    <div className="flex flex-col gap-1 border-b border-border pb-3">
      <div className="flex items-center gap-2">
        <span className="flex size-7 items-center justify-center rounded-md bg-brand text-brand-foreground">
          <Icon aria-hidden className="size-4" />
        </span>
        <h2 className="text-[15px] font-semibold">{info.label}</h2>
        <span className="flex-1" />
        <kbd className="rounded bg-muted px-1.5 py-0.5 font-sans text-xs text-muted-foreground">
          {info.key}
        </kbd>
      </div>
      <p className="text-xs text-muted-foreground">
        {selected
          ? count > 1
            ? `${String(count)} ${noun}${noun.endsWith("s") ? "" : "s"} selected`
            : `Selected ${noun}`
          : `Defaults for new ${plural(tool)}`}
      </p>
    </div>
  );
}

/** "arrows", "highlights", "redactions" (the captions of the design). */
function plural(tool: ToolId): string {
  const noun = toolById(tool).label.toLowerCase();
  if (tool === "highlighter") return "highlights";
  if (tool === "pencil") return "pencil strokes";
  return noun.endsWith("s") ? noun : `${noun}s`;
}
