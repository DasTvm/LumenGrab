import { describe, expect, it } from "vitest";
import { createEditorStore } from "../model/store";
import { projectWith } from "../model/test-layers";
import type { Layer } from "@/document/schema";
import { finishEditing, setText, setTextWidth, startEditText, startNewText } from "./text-edit";
import { createUiStore } from "./ui-store";

const text = (id: string, value: string): Layer => ({
  id,
  visible: true,
  locked: false,
  type: "text",
  x: 10,
  y: 20,
  width: null,
  text: value,
  fontId: "inter",
  size: 24,
  weight: 500,
  color: "#18181B",
  background: null,
  align: "left",
  rotation: 0,
});

const setup = (layers: Layer[] = []) => ({
  editor: createEditorStore(projectWith(layers)),
  ui: createUiStore(),
});
const only = (s: ReturnType<typeof setup>) =>
  s.editor.getState().project.layers[0] as unknown as Record<string, unknown>;

describe("text editing", () => {
  it("a new text box takes the options of the text tool and is selected while it is typed in", () => {
    const s = setup();
    s.ui.getState().setOption("text", { fontId: "jetbrains-mono", size: 40, color: "#2563EB" });
    const id = startNewText(s.editor, s.ui, { x: 100.123, y: 50 });
    expect(only(s)).toMatchObject({
      id,
      type: "text",
      text: "",
      x: 100.12,
      y: 50,
      fontId: "jetbrains-mono",
      size: 40,
      color: "#2563EB",
      width: null,
    });
    expect(s.editor.getState().selection).toEqual([id]);
    expect(s.ui.getState().editing).toEqual({ id, isNew: true });
  });

  it("typing and finishing is one undo step", () => {
    const s = setup();
    const id = startNewText(s.editor, s.ui, { x: 0, y: 0 });
    for (const t of ["C", "Ch", "Che", "Check the total"]) setText(s.editor, id, t);
    setTextWidth(s.editor, id, 180);
    finishEditing(s.editor, s.ui);
    expect(only(s)).toMatchObject({ text: "Check the total", width: 180 });
    expect(s.ui.getState().editing).toBeNull();
    expect(s.editor.getState().selection).toEqual([id]);
    s.editor.getState().undo();
    expect(s.editor.getState().project.layers).toHaveLength(0);
    expect(s.editor.getState().canUndo).toBe(false);
  });

  it("a box that stays empty leaves nothing behind, not even a history step", () => {
    const s = setup();
    startNewText(s.editor, s.ui, { x: 0, y: 0 });
    finishEditing(s.editor, s.ui);
    expect(s.editor.getState().project.layers).toHaveLength(0);
    expect(s.editor.getState().canUndo).toBe(false);
    expect(s.editor.getState().dirty).toBe(false);
    startNewText(s.editor, s.ui, { x: 0, y: 0 });
    setText(s.editor, s.ui.getState().editing?.id ?? "", "   ");
    finishEditing(s.editor, s.ui);
    expect(s.editor.getState().project.layers).toHaveLength(0);
  });

  it("edits an existing text, one step, and a text emptied out is deleted in that step", () => {
    const s = setup([text("t", "Old")]);
    expect(startEditText(s.editor, s.ui, "t")).toBe(true);
    setText(s.editor, "t", "New words");
    finishEditing(s.editor, s.ui);
    expect(only(s)["text"]).toBe("New words");
    s.editor.getState().undo();
    expect(only(s)["text"]).toBe("Old");

    startEditText(s.editor, s.ui, "t");
    setText(s.editor, "t", "");
    finishEditing(s.editor, s.ui);
    expect(s.editor.getState().project.layers).toHaveLength(0);
    s.editor.getState().undo();
    expect(only(s)["text"]).toBe("Old");
  });

  it("editing without a change adds no step", () => {
    const s = setup([text("t", "Same")]);
    startEditText(s.editor, s.ui, "t");
    setText(s.editor, "t", "Same");
    finishEditing(s.editor, s.ui);
    expect(s.editor.getState().canUndo).toBe(false);
    expect(s.editor.getState().dirty).toBe(false);
  });

  it("only edits text layers that are not locked", () => {
    const s = setup([
      { ...text("t", "x"), locked: true } as Layer,
      projectWith([]).layers[0] as never,
    ]);
    expect(startEditText(s.editor, s.ui, "t")).toBe(false);
    expect(startEditText(s.editor, s.ui, "nope")).toBe(false);
    expect(s.ui.getState().editing).toBeNull();
  });

  it("starting another edit finishes the first one", () => {
    const s = setup([text("a", "One"), text("b", "Two")]);
    startEditText(s.editor, s.ui, "a");
    setText(s.editor, "a", "One!");
    startEditText(s.editor, s.ui, "b");
    expect(s.ui.getState().editing?.id).toBe("b");
    expect(
      (s.editor.getState().project.layers[0] as unknown as Record<string, unknown>)["text"],
    ).toBe("One!");
    finishEditing(s.editor, s.ui);
    s.editor.getState().undo();
    expect(
      (s.editor.getState().project.layers[0] as unknown as Record<string, unknown>)["text"],
    ).toBe("One");
    s.editor.getState().undo();
  });

  it("keeps the width at least 20 px", () => {
    const s = setup([text("t", "x")]);
    startEditText(s.editor, s.ui, "t");
    setTextWidth(s.editor, "t", 3);
    expect(only(s)["width"]).toBe(20);
  });
});
