import { ArrowDown, ArrowUp, Copy, MousePointerClick, Trash2 } from "lucide-react";
import { Button } from "@/ui/components/button";
import { findLayer } from "../model/tree";
import { useEditor, useStores, useUi } from "./context";
import { TOOL_ICONS } from "./icons";
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
  const only = selection.length === 1 ? findLayer(layers, selection[0] ?? "") : null;
  const layerTool = only ? toolForLayerType(only.type) : null;
  // The panel follows the selection; with nothing selected it follows the active tool.
  const shown: ToolId | null = layerTool ?? (tool === "select" || tool === "crop" ? null : tool);
  const count = selection.length;

  return (
    <div className="flex min-h-0 flex-1 flex-col" data-testid="style-panel">
      {shown ? (
        <PanelTitle tool={shown} selected={layerTool !== null} />
      ) : (
        <div className="flex flex-1 flex-col items-center justify-center gap-2 px-6 text-center">
          <MousePointerClick aria-hidden className="size-6 text-muted-foreground" />
          <p className="text-sm font-medium">
            {count > 1
              ? `${String(count)} layers selected`
              : only
                ? "Group selected"
                : "Nothing selected"}
          </p>
          <p className="text-[13px] text-muted-foreground">
            {count > 0
              ? "Move them together, or open the Layers tab to group, hide or lock."
              : "Click a layer on the picture, or pick a tool to draw."}
          </p>
        </div>
      )}
      {shown ? <div className="flex-1" /> : null}
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

function PanelTitle({ tool, selected }: { tool: ToolId; selected: boolean }) {
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
        {selected ? `Selected ${noun}` : `Defaults for new ${noun}${noun.endsWith("s") ? "" : "s"}`}
      </p>
    </div>
  );
}
