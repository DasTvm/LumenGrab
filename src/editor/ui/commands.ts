import { isStyleTool, layerIsOf } from "../model/bindings";
import type { EditorStoreApi } from "../model/store";
import { findLayer } from "../model/tree";
import { startCrop } from "./crop-mode";
import type { ToolId } from "./tools";
import type { EditorCommand } from "./shortcuts";
import type { UiStoreApi } from "./ui-store";
import { centerView, fitView, stepZoom, zoomAt } from "./view";

export interface CommandEnv {
  editor: EditorStoreApi;
  ui: UiStoreApi;
  /** Commands that leave the editor (save, export, copy); the window supplies them. */
  outside?: Partial<Record<"save" | "saveAs" | "export" | "copy", () => void>>;
}

/**
 * Picks a tool. A drawing tool starts from its own defaults, so a selection of something else is
 * dropped (selecting a rectangle and pressing A for Arrow should not leave the rectangle selected).
 */
export function chooseTool(editor: EditorStoreApi, ui: UiStoreApi, tool: ToolId): void {
  const { project, selection } = editor.getState();
  if (isStyleTool(tool) && selection.length > 0) {
    const mine = selection.every((id) => {
      const layer = findLayer(project.layers, id);
      return layer !== null && layerIsOf(tool, layer);
    });
    if (!mine) editor.getState().select([]);
  }
  ui.getState().setTool(tool);
  if (tool === "crop") startCrop(editor, ui);
}

/** Runs a command. Shortcuts, menus and buttons all end up here, so they cannot disagree. */
export function runCommand(command: EditorCommand, env: CommandEnv): void {
  const { editor, ui } = env;
  const state = editor.getState();
  switch (command.type) {
    case "undo":
      state.undo();
      return;
    case "redo":
      state.redo();
      return;
    case "delete":
      state.deleteLayers();
      return;
    case "duplicate":
      state.duplicateLayers();
      return;
    case "group":
      state.group();
      return;
    case "ungroup":
      state.ungroup();
      return;
    case "front":
    case "back":
    case "forward":
    case "backward":
      state.reorder(command.type);
      return;
    case "selectAll":
      state.select(state.project.layers.filter((l) => l.visible && !l.locked).map((l) => l.id));
      return;
    case "deselect":
      state.select([]);
      return;
    case "nudge":
      state.nudge(command.dx, command.dy);
      return;
    case "tool":
      chooseTool(editor, ui, command.tool);
      return;
    case "fit":
    case "zoom100":
    case "zoomIn":
    case "zoomOut": {
      const view = ui.getState().view;
      if (!view) return;
      const { area } = ui.getState();
      const content = (ui.getState().crop ? null : state.project.crop) ?? {
        x: 0,
        y: 0,
        ...ui.getState().imageSize,
      };
      if (command.type === "fit") ui.getState().setView(fitView(area, content), true);
      else if (command.type === "zoom100") ui.getState().setView(centerView(area, content, 1));
      else {
        const next = stepZoom(view.zoom, command.type === "zoomIn" ? 1 : -1);
        ui.getState().setView(zoomAt(view, { x: area.width / 2, y: area.height / 2 }, next));
      }
      return;
    }
    case "save":
    case "saveAs":
    case "export":
    case "copy":
      env.outside?.[command.type]?.();
      return;
  }
}

/** True if the keyboard focus is in a field where letters are text, not shortcuts. */
export function isTyping(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  return (
    target.isContentEditable ||
    target instanceof HTMLTextAreaElement ||
    (target instanceof HTMLInputElement &&
      !["checkbox", "radio", "range", "button"].includes(target.type)) ||
    target instanceof HTMLSelectElement
  );
}
