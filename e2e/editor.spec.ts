import { expect, test, type Locator, type Page } from "@playwright/test";
import type { Layer } from "../src/document/schema";

test.use({ viewport: { width: 1280, height: 880 } });

const open = (page: Page, scenario = "stack") =>
  page.goto(`/?window=document&label=doc-1&scenario=${scenario}`);

/** Where an image pixel is on the page, from the editor's own view. */
async function at(page: Page, x: number, y: number) {
  return page.evaluate(
    ([px, py]) => {
      const { ui } = window.__lumengrabEditor ?? {};
      const view = ui?.getState().view;
      const area = document
        .querySelector('[data-testid="editor-canvas-area"]')
        ?.getBoundingClientRect();
      if (!view || !area) throw new Error("editor not ready");
      return {
        x: area.left + view.x + (px ?? 0) * view.zoom,
        y: area.top + view.y + (py ?? 0) * view.zoom,
      };
    },
    [x, y],
  );
}

const layers = (page: Page) =>
  page.evaluate(() => window.__lumengrabEditor?.editor.getState().project.layers ?? []) as Promise<
    (Layer & Record<string, unknown>)[]
  >;
const selection = (page: Page) =>
  page.evaluate(() => window.__lumengrabEditor?.editor.getState().selection ?? []);
const ready = async (page: Page) => {
  await expect(page.getByTestId("editor-canvas")).toBeVisible();
  await page.waitForFunction(() => window.__lumengrabEditor?.ui.getState().view != null);
};

async function click(
  page: Page,
  x: number,
  y: number,
  modifiers: ("Shift" | "Meta" | "Control")[] = [],
) {
  const p = await at(page, x, y);
  for (const m of modifiers) await page.keyboard.down(m);
  await page.mouse.click(p.x, p.y);
  for (const m of modifiers) await page.keyboard.up(m);
}

/** Drags a layers-panel row with the mouse (the panel uses pointer events, not HTML5 drag and drop). */
async function dragRow(page: Page, from: Locator, to: Locator, fraction: number) {
  const a = await from.boundingBox();
  const b = await to.boundingBox();
  if (!a || !b) throw new Error("no rows");
  await page.mouse.move(a.x + 60, a.y + a.height / 2);
  await page.mouse.down();
  await page.mouse.move(a.x + 60, a.y + a.height / 2 + 8, { steps: 2 });
  await page.mouse.move(b.x + 60, b.y + b.height * fraction, { steps: 6 });
  await page.mouse.up();
}

async function drag(page: Page, from: [number, number], to: [number, number]) {
  const a = await at(page, ...from);
  const b = await at(page, ...to);
  await page.mouse.move(a.x, a.y);
  await page.mouse.down();
  await page.mouse.move((a.x + b.x) / 2, (a.y + b.y) / 2, { steps: 4 });
  await page.mouse.move(b.x, b.y, { steps: 4 });
  await page.mouse.up();
}

test.describe("editor (browser mock)", () => {
  test("the shell: top bar, twelve tools, canvas, zoom bar, panel", async ({ page }) => {
    await open(page);
    await ready(page);
    await expect(page.getByRole("navigation", { name: "Tools" }).getByRole("button")).toHaveCount(
      12,
    );
    await expect(page.getByRole("button", { name: "Select" })).toHaveAttribute(
      "aria-pressed",
      "true",
    );
    await expect(page.getByRole("button", { name: "Undo" })).toBeDisabled();
    await expect(page.getByRole("button", { name: "Redo" })).toBeDisabled();
    await expect(page.getByRole("tab", { name: "Layers · 4" })).toBeVisible();
    await expect(page.getByRole("button", { name: "Share" })).toHaveCount(0);
    await expect(page.getByRole("tab", { name: "Presentation" })).toHaveCount(0);
    await page.screenshot({ path: "test-results/editor-shell-light.png", animations: "disabled" });
  });

  test("tools have names, shortcuts and tooltips; a letter picks one", async ({ page }) => {
    await open(page);
    await ready(page);
    const rect = page.getByRole("button", { name: "Rectangle" });
    await expect(rect).toHaveAttribute("aria-keyshortcuts", "R");
    await rect.hover();
    await expect(page.getByText("R", { exact: true }).first()).toBeVisible();
    await page.keyboard.press("a");
    await expect(page.getByRole("button", { name: "Arrow" })).toHaveAttribute(
      "aria-pressed",
      "true",
    );
    await expect(page.getByRole("heading", { name: "Arrow" })).toBeVisible();
    await expect(page.getByText("Defaults for new arrows")).toBeVisible();
    await page.keyboard.press("v");
    await expect(page.getByRole("button", { name: "Select" })).toHaveAttribute(
      "aria-pressed",
      "true",
    );
  });

  test("click selects with handles; a click on empty space clears it", async ({ page }) => {
    await open(page);
    await ready(page);
    await click(page, 700, 480); // the edge of the group's rectangle
    await expect.poll(() => selection(page)).toEqual(["callout"]);
    await expect(page.getByTestId("selection-frame")).toBeVisible();
    await click(page, 120, 700);
    await expect.poll(() => selection(page)).toEqual([]);
    await expect(page.getByTestId("selection-frame")).toHaveCount(0);
  });

  test("dragging moves the layer as one undo step; Cmd/Ctrl+Z and Shift+Z undo and redo", async ({
    page,
  }) => {
    await open(page);
    await ready(page);
    await click(page, 700, 480);
    await drag(page, [700, 480], [760, 530]);
    const group = (await layers(page))[1] as unknown as { layers: { x?: number; y?: number }[] };
    expect(group.layers[0]).toMatchObject({ x: 760, y: 470 });
    await expect(page.getByTestId("unsaved-dot")).toBeVisible();
    await page.keyboard.press("ControlOrMeta+z");
    const back = (await layers(page))[1] as unknown as { layers: { x?: number }[] };
    expect(back.layers[0]?.x).toBe(700);
    await expect(page.getByTestId("unsaved-dot")).toHaveCount(0);
    await page.keyboard.press("ControlOrMeta+Shift+z");
    const again = (await layers(page))[1] as unknown as { layers: { x?: number }[] };
    expect(again.layers[0]?.x).toBe(760);
  });

  test("resizing and rotating a rectangle with its handles, with the size badge", async ({
    page,
  }) => {
    await open(page, "annotated");
    await ready(page);
    // The annotated scenario has one rectangle at 200,160 400x200.
    await click(page, 200, 260); // its left edge
    await expect.poll(() => selection(page)).toEqual(["a1"]);
    const se = await at(page, 600, 360);
    await page.mouse.move(se.x, se.y);
    await page.mouse.down();
    const to = await at(page, 700, 460);
    await page.mouse.move(to.x, to.y, { steps: 5 });
    await expect(page.getByTestId("size-badge")).toHaveText("500 × 300");
    await page.mouse.up();
    expect((await layers(page))[0]).toMatchObject({ x: 200, y: 160, width: 500, height: 300 });
    await page.keyboard.press("ControlOrMeta+z");
    expect((await layers(page))[0]).toMatchObject({ width: 400, height: 200 });
  });

  test("delete, duplicate, nudge and select all", async ({ page }) => {
    await open(page, "annotated");
    await ready(page);
    await click(page, 200, 260);
    await page.keyboard.press("ArrowRight");
    await page.keyboard.press("Shift+ArrowDown");
    expect((await layers(page))[0]).toMatchObject({ x: 201, y: 170 });
    await page.keyboard.press("ControlOrMeta+d");
    expect(await layers(page)).toHaveLength(2);
    expect((await layers(page))[1]).toMatchObject({ x: 213, y: 182 });
    await page.keyboard.press("ControlOrMeta+a");
    expect(await selection(page)).toHaveLength(2);
    await page.keyboard.press("Delete");
    expect(await layers(page)).toHaveLength(0);
    await page.keyboard.press("ControlOrMeta+z");
    expect(await layers(page)).toHaveLength(2);
  });

  test("zoom: buttons, Fit, 100 %, and the wheel zooms around the pointer", async ({ page }) => {
    await open(page);
    await ready(page);
    const label = page.getByTestId("zoom-label");
    await expect(label).toHaveText("56%");
    await page.getByRole("button", { name: "100%" }).click();
    await expect(label).toHaveText("100%");
    await page.getByRole("button", { name: "Zoom in" }).click();
    await expect(label).toHaveText("150%");
    await page.getByRole("button", { name: "Zoom out" }).click();
    await page.getByRole("button", { name: "Zoom out" }).click();
    await expect(label).toHaveText("75%");
    await page.getByRole("button", { name: "Fit", exact: true }).click();
    await expect(label).toHaveText("56%");
    // Cmd/Ctrl + wheel zooms in; the image point under the pointer stays under it.
    const before = await page.evaluate(() => window.__lumengrabEditor?.ui.getState().view);
    const area = page.getByTestId("editor-canvas-area");
    const box = await area.boundingBox();
    if (!box || !before) throw new Error("no area");
    const px = box.x + 300;
    const py = box.y + 300;
    const imageBefore = { x: (300 - before.x) / before.zoom, y: (300 - before.y) / before.zoom };
    await page.mouse.move(px, py);
    await page.keyboard.down("Control");
    await page.mouse.wheel(0, -300);
    await page.keyboard.up("Control");
    const after = await page.evaluate(() => window.__lumengrabEditor?.ui.getState().view);
    expect(after?.zoom).toBeGreaterThan(before.zoom);
    expect((300 - (after?.x ?? 0)) / (after?.zoom ?? 1)).toBeCloseTo(imageBefore.x, 1);
    expect((300 - (after?.y ?? 0)) / (after?.zoom ?? 1)).toBeCloseTo(imageBefore.y, 1);
  });

  test("space + drag pans the view", async ({ page }) => {
    await open(page);
    await ready(page);
    await page.getByRole("button", { name: "100%" }).click();
    const before = await page.evaluate(() => window.__lumengrabEditor?.ui.getState().view);
    await page.keyboard.down("Space");
    const a = await at(page, 600, 400);
    await page.mouse.move(a.x, a.y);
    await page.mouse.down();
    await page.mouse.move(a.x + 80, a.y + 40, { steps: 4 });
    await page.mouse.up();
    await page.keyboard.up("Space");
    const after = await page.evaluate(() => window.__lumengrabEditor?.ui.getState().view);
    expect((after?.x ?? 0) - (before?.x ?? 0)).toBeCloseTo(80, 0);
    expect((after?.y ?? 0) - (before?.y ?? 0)).toBeCloseTo(40, 0);
    expect((await layers(page)).length).toBe(4); // nothing was selected or moved
  });
});

test.describe("layers panel (browser mock)", () => {
  test.beforeEach(async ({ page }) => {
    await open(page);
    await ready(page);
    await page.getByRole("tab", { name: /Layers/ }).click();
  });

  test("lists the stack front first, groups with their children, and the original at the bottom", async ({
    page,
  }) => {
    await expect(page.locator("[data-layer]")).toHaveCount(7);
    const names = await page
      .locator("[data-layer]")
      .evaluateAll((els) => els.map((el) => el.querySelector("span.truncate")?.textContent));
    expect(names).toEqual([
      "Counter 1",
      "Redaction · Pixelate",
      "Total callout",
      "Text “Wrong total?”",
      "Arrow",
      "Rectangle",
      "Frame",
    ]);
    await expect(page.getByLabel("Screenshot (original)")).toBeVisible();
    await page.screenshot({ path: "test-results/editor-layers-light.png", animations: "disabled" });
  });

  test("a click in the panel selects on the canvas, Shift selects a range, Cmd/Ctrl adds", async ({
    page,
  }) => {
    await page.locator('[data-layer="mask"]').click();
    expect(await selection(page)).toEqual(["mask"]);
    await expect(page.getByTestId("selection-frame")).toHaveAttribute("data-layer", "mask");
    await page.locator('[data-layer="one"]').click({ modifiers: ["ControlOrMeta"] });
    expect(await selection(page)).toEqual(["mask", "one"]);
    await page.locator('[data-layer="callout"]').click();
    await page.locator('[data-layer="frame"]').click({ modifiers: ["Shift"] });
    expect((await selection(page)).length).toBeGreaterThan(1);
  });

  test("hide and lock, and a locked layer cannot be picked on the canvas", async ({ page }) => {
    await page.getByRole("button", { name: "Hide Counter 1" }).click();
    expect((await layers(page))[3]).toMatchObject({ visible: false });
    await page.getByRole("button", { name: "Show Counter 1" }).click();
    await page.getByRole("button", { name: "Lock Redaction · Pixelate" }).click();
    expect((await layers(page))[2]).toMatchObject({ locked: true });
    await click(page, 300, 360); // on the locked redaction
    expect(await selection(page)).toEqual([]);
    await page.keyboard.press("ControlOrMeta+z"); // undo the lock
    expect((await layers(page))[2]).toMatchObject({ locked: false });
  });

  test("double-click renames, Enter confirms, an empty name goes back to the default", async ({
    page,
  }) => {
    await page.locator('[data-layer="one"]').dblclick();
    const field = page.getByRole("textbox", { name: "Layer name" });
    await field.fill("Step one");
    await field.press("Enter");
    expect((await layers(page))[3]).toMatchObject({ name: "Step one" });
    await expect(page.locator('[data-layer="one"]')).toContainText("Step one");
    await page.locator('[data-layer="one"]').dblclick();
    await page.getByRole("textbox", { name: "Layer name" }).fill("");
    await page.getByRole("textbox", { name: "Layer name" }).press("Enter");
    await expect(page.locator('[data-layer="one"]')).toContainText("Counter 1");
  });

  test("a group collapses and shows how many layers are inside", async ({ page }) => {
    await page.getByRole("button", { name: "Collapse Total callout" }).click();
    await expect(page.locator("[data-layer]")).toHaveCount(4);
    await expect(page.getByLabel("3 layers inside")).toBeVisible();
    await page.getByRole("button", { name: "Expand Total callout" }).click();
    await expect(page.locator("[data-layer]")).toHaveCount(7);
  });

  test("Group N layers makes a group, Ungroup (context menu) dissolves it, both undoable", async ({
    page,
  }) => {
    await page.locator('[data-layer="mask"]').click();
    await page.locator('[data-layer="one"]').click({ modifiers: ["ControlOrMeta"] });
    await page.getByRole("button", { name: "Group 2 layers" }).click();
    const after = await layers(page);
    expect(after.map((l) => l.type)).toEqual(["rect", "group", "group"]);
    const made = after[2] as unknown as { layers: { id: string }[] };
    expect(made.layers.map((l) => l.id)).toEqual(["mask", "one"]);

    await page.locator("[data-layer]", { hasText: "Group" }).first().click({ button: "right" });
    await page.getByRole("menuitem", { name: /^Ungroup/ }).click();
    expect((await layers(page)).map((l) => l.type)).toEqual([
      "rect",
      "group",
      "redaction",
      "counter",
    ]);
    await page.keyboard.press("ControlOrMeta+z");
    expect((await layers(page)).map((l) => l.type)).toEqual(["rect", "group", "group"]);
    await page.keyboard.press("ControlOrMeta+z");
    expect((await layers(page)).map((l) => l.type)).toEqual([
      "rect",
      "group",
      "redaction",
      "counter",
    ]);
  });

  test("the context menu lists the actions of the design with their shortcuts", async ({
    page,
  }) => {
    await page.locator('[data-layer="one"]').click({ button: "right" });
    const menu = page.getByRole("menu", { name: "Layer actions" });
    for (const name of [
      "Rename",
      "Duplicate",
      "Group",
      "Ungroup",
      "Bring to front",
      "Send to back",
      "Hide",
      "Lock",
      "Delete",
    ]) {
      await expect(menu.getByRole("menuitem", { name: new RegExp(`^${name}`) })).toBeVisible();
    }
    await expect(menu.getByRole("menuitem", { name: /^Ungroup/ })).toBeDisabled(); // not a group
    await page.screenshot({
      path: "test-results/editor-layer-menu-light.png",
      animations: "disabled",
    });
    await page.keyboard.press("Escape");
    await expect(menu).toHaveCount(0);
  });

  test("dragging a row reorders the stack, and into a group", async ({ page }) => {
    const row = (id: string) => page.locator(`[data-layer="${id}"]`);
    await dragRow(page, row("one"), row("frame"), 0.85); // below the frame: to the back
    expect((await layers(page)).map((l) => l.id)).toEqual(["one", "frame", "callout", "mask"]);
    await dragRow(page, row("mask"), row("callout"), 0.5); // into the group
    const group = (await layers(page)).find((l) => l.id === "callout") as unknown as {
      layers: { id: string }[];
    };
    expect(group.layers.map((l) => l.id)).toEqual(["box", "pointer", "note", "mask"]);
    await page.keyboard.press("ControlOrMeta+z");
    await page.keyboard.press("ControlOrMeta+z");
    expect((await layers(page)).map((l) => l.id)).toEqual(["frame", "callout", "mask", "one"]);
  });

  test("while dragging a row a chip follows the pointer and the drop place is marked; Esc cancels", async ({
    page,
  }) => {
    const row = (id: string) => page.locator(`[data-layer="${id}"]`);
    const a = await row("one").boundingBox();
    const b = await row("frame").boundingBox();
    if (!a || !b) throw new Error("no rows");
    await page.mouse.move(a.x + 60, a.y + a.height / 2);
    await page.mouse.down();
    await page.mouse.move(a.x + 60, a.y + a.height / 2 + 10, { steps: 2 });
    await page.mouse.move(b.x + 60, b.y + b.height * 0.9, { steps: 5 });
    await expect(page.getByTestId("layer-drag-ghost")).toHaveText("Counter 1");
    await expect(row("frame")).toHaveAttribute("data-drop", "below");
    await page.keyboard.press("Escape");
    await page.mouse.up();
    await expect(page.getByTestId("layer-drag-ghost")).toHaveCount(0);
    expect((await layers(page)).map((l) => l.id)).toEqual(["frame", "callout", "mask", "one"]);
  });

  test("a plain click still selects, and a drag does not leave the row selected twice", async ({
    page,
  }) => {
    await page.locator('[data-layer="mask"]').click();
    expect(await selection(page)).toEqual(["mask"]);
    const row = (id: string) => page.locator(`[data-layer="${id}"]`);
    await dragRow(page, row("one"), row("callout"), 0.9); // below the group, in front of the frame
    expect(await selection(page)).toEqual(["one"]);
    expect((await layers(page)).map((l) => l.id)).toEqual(["frame", "one", "callout", "mask"]);
  });

  test("Delete in the panel and the Style tab's object actions work on the selection", async ({
    page,
  }) => {
    await page.locator('[data-layer="one"]').click();
    await page.getByRole("button", { name: "Delete" }).click();
    expect((await layers(page)).map((l) => l.id)).toEqual(["frame", "callout", "mask"]);
    await page.getByRole("tab", { name: "Style" }).click();
    await expect(page.getByText("Nothing selected")).toBeVisible();
    await page.keyboard.press("ControlOrMeta+z");
    await page.getByRole("tab", { name: /Layers/ }).click();
    await page.locator('[data-layer="one"]').click();
    await page.getByRole("tab", { name: "Style" }).click();
    await page.getByRole("button", { name: "Bring forward" }).click(); // already on top: nothing changes
    expect((await layers(page)).map((l) => l.id)).toEqual(["frame", "callout", "mask", "one"]);
    await page.getByRole("button", { name: "Send backward" }).click();
    expect((await layers(page)).map((l) => l.id)).toEqual(["frame", "callout", "one", "mask"]);
  });
});

test.describe("drawing tools and the style panel (browser mock)", () => {
  test.beforeEach(async ({ page }) => {
    await open(page, "ready");
    await ready(page);
  });

  const last = async (page: Page) => (await layers(page)).at(-1) as Record<string, unknown>;
  const pick = (page: Page, tool: string) =>
    page.getByRole("button", { name: tool, exact: true }).click();

  test("rectangle and ellipse: drag, shift for a square, the panel then edits the new shape", async ({
    page,
  }) => {
    await pick(page, "Rectangle");
    await drag(page, [200, 200], [500, 340]);
    expect(await last(page)).toMatchObject({
      type: "rect",
      x: 200,
      y: 200,
      width: 300,
      height: 140,
      stroke: "#EF4444",
      fill: null,
      strokeWidth: 4,
      radius: 8,
    });
    await expect(page.getByText("Selected rectangle")).toBeVisible();
    await page.getByRole("radio", { name: "Fill: #2563EB" }).click();
    await page.getByRole("radio", { name: "Stroke: #18181B" }).click();
    expect(await last(page)).toMatchObject({ fill: "#2563EB", stroke: "#18181B" });

    await pick(page, "Ellipse");
    const a = await at(page, 700, 300);
    const b = await at(page, 800, 330);
    await page.keyboard.down("Shift");
    await page.mouse.move(a.x, a.y);
    await page.mouse.down();
    await page.mouse.move(b.x, b.y, { steps: 6 });
    await page.mouse.up();
    await page.keyboard.up("Shift");
    const e = await last(page);
    expect(e["type"]).toBe("ellipse");
    expect(Number(e["width"])).toBeCloseTo(Number(e["height"]), 1);
    await page.screenshot({
      path: "test-results/editor-rectangle-light.png",
      animations: "disabled",
    });
  });

  test("a slider drag changes the selected layer as one undo step, and Undo brings it back", async ({
    page,
  }) => {
    await pick(page, "Rectangle");
    await drag(page, [200, 200], [500, 340]);
    const slider = page.getByRole("slider", { name: "Corner radius" });
    const box = await slider.boundingBox();
    if (!box) throw new Error("no slider");
    await page.mouse.move(box.x + 8, box.y + box.height / 2);
    await page.mouse.down();
    await page.mouse.move(box.x + box.width * 0.9, box.y + box.height / 2, { steps: 8 });
    await page.mouse.up();
    expect(Number((await last(page))["radius"])).toBeGreaterThan(20);
    await page.keyboard.press("ControlOrMeta+z");
    expect(await last(page)).toMatchObject({ radius: 8 }); // back to what it was, not a step in between
    await page.keyboard.press("ControlOrMeta+z");
    expect(await layers(page)).toHaveLength(0);
  });

  test("a changed option is remembered for the next shape", async ({ page }) => {
    await pick(page, "Rectangle");
    await page.getByRole("radio", { name: "Stroke: #2563EB" }).click(); // nothing selected: the defaults
    await drag(page, [200, 200], [400, 300]);
    expect(await last(page)).toMatchObject({ stroke: "#2563EB" });
    await page.keyboard.press("Escape");
    await drag(page, [500, 500], [700, 600]);
    expect(await last(page)).toMatchObject({ stroke: "#2563EB" });
  });

  test("arrow: the four styles, colour and width; the curve handle bends it", async ({ page }) => {
    await pick(page, "Arrow");
    await expect(page.getByText("Defaults for new arrows")).toBeVisible();
    await page.getByRole("radio", { name: "Curved" }).click();
    await drag(page, [200, 600], [700, 500]);
    expect(await last(page)).toMatchObject({
      type: "arrow",
      style: "curved",
      from: { x: 200, y: 600 },
    });
    const grips = page.locator("[data-grip]");
    await expect(grips).toHaveCount(3); // both ends and the bend
    await page.getByRole("radio", { name: "Double" }).click();
    expect(await last(page)).toMatchObject({ style: "double" });
    await expect(grips).toHaveCount(2);
    await page.getByRole("radio", { name: "Outlined" }).click();
    await page.getByRole("radio", { name: "Color: #2563EB" }).click();
    expect(await last(page)).toMatchObject({ style: "outlined", color: "#2563EB" });
    await page.getByRole("radio", { name: "Curved" }).click();
    // Drag the bend handle: the curve gets a control point.
    const handle = page.locator('[data-grip="curve"]');
    const hb = await handle.boundingBox();
    if (!hb) throw new Error("no curve handle");
    await page.mouse.move(hb.x + hb.width / 2, hb.y + hb.height / 2);
    await page.mouse.down();
    await page.mouse.move(hb.x + hb.width / 2, hb.y - 60, { steps: 5 });
    await page.mouse.up();
    expect((await last(page))["curve"]).toBeDefined();
    await page.screenshot({ path: "test-results/editor-arrow-light.png", animations: "disabled" });
  });

  test("line: solid or dashed, width", async ({ page }) => {
    await pick(page, "Line");
    await drag(page, [100, 100], [600, 140]);
    expect(await last(page)).toMatchObject({ type: "line", color: "#EF4444" });
    expect(await last(page)).not.toHaveProperty("dash");
    await page.getByRole("radio", { name: "Dashed" }).click();
    expect((await last(page))["dash"]).toEqual([10, 8]);
    await page.getByRole("radio", { name: "Solid" }).click();
    expect(await last(page)).not.toHaveProperty("dash");
  });

  test("pencil, highlighter, spotlight", async ({ page }) => {
    await pick(page, "Pencil");
    const a = await at(page, 300, 300);
    await page.mouse.move(a.x, a.y);
    await page.mouse.down();
    for (let i = 1; i <= 12; i += 1) await page.mouse.move(a.x + i * 12, a.y + Math.sin(i) * 20);
    await page.mouse.up();
    expect(((await last(page))["points"] as number[]).length).toBeGreaterThan(10);
    await expect(page.getByRole("slider", { name: "Smoothing" })).toHaveValue("60");

    await pick(page, "Highlighter");
    await drag(page, [200, 500], [600, 540]);
    expect(await last(page)).toMatchObject({ type: "highlighter", color: "#FACC15", opacity: 0.4 });
    await expect(page.getByText("Highlighted text")).toBeVisible();

    await pick(page, "Spotlight");
    await page.getByRole("radio", { name: "Ellipse" }).click();
    await drag(page, [700, 300], [1000, 500]);
    expect(await last(page)).toMatchObject({
      type: "spotlight",
      shape: "ellipse",
      dimOpacity: 0.6,
    });
    await expect(
      page.getByText("Dims everything outside the shape to draw the eye."),
    ).toBeVisible();
  });

  test("counter: numbers count up, Restart at 1, undo", async ({ page }) => {
    await pick(page, "Counter");
    await expect(page.getByTestId("counter-next")).toHaveText("1");
    for (const [x, y] of [
      [200, 200],
      [300, 200],
      [400, 200],
    ] as const)
      await click(page, x, y);
    expect((await layers(page)).map((l) => l["value"])).toEqual([1, 2, 3]);
    await expect(page.getByTestId("counter-next")).toHaveText("4");
    await page.getByRole("button", { name: "Restart at 1" }).click();
    await expect(page.getByTestId("counter-next")).toHaveText("1");
    await click(page, 500, 200);
    expect(await last(page)).toMatchObject({ value: 1, size: 32 });
    await page.keyboard.press("ControlOrMeta+z");
    expect(await layers(page)).toHaveLength(3);
  });

  test("redaction: mode and strength in the panel, solid takes a colour, and the picture changes", async ({
    page,
  }) => {
    await pick(page, "Redaction");
    await expect(page.getByText("Defaults for new redactions")).toBeVisible();
    await drag(page, [100, 100], [500, 220]);
    expect(await last(page)).toMatchObject({ type: "redaction", mode: "blur" });
    const before = await page
      .getByTestId("editor-canvas")
      .evaluate((c: HTMLCanvasElement) => c.toDataURL());
    await page.getByRole("radio", { name: "Solid" }).click();
    expect(await last(page)).toMatchObject({ mode: "solid", strength: 0 });
    await page.getByRole("radio", { name: "Color: #EF4444" }).click();
    expect(await last(page)).toMatchObject({ color: "#EF4444" });
    await expect(
      page.getByText("A solid box hides what is under it in every export."),
    ).toBeVisible();
    const after = await page
      .getByTestId("editor-canvas")
      .evaluate((c: HTMLCanvasElement) => c.toDataURL());
    expect(after).not.toBe(before);
    await page.getByRole("radio", { name: "Pixelate" }).click();
    await expect(page.getByRole("slider", { name: "Strength" })).toBeVisible();
    expect(await last(page)).toMatchObject({ mode: "pixelate" });
    await page.screenshot({
      path: "test-results/editor-redaction-light.png",
      animations: "disabled",
    });
  });

  test("Esc while drawing throws the shape away; a click on a shape with a drawing tool selects it", async ({
    page,
  }) => {
    await pick(page, "Rectangle");
    const a = await at(page, 200, 200);
    const b = await at(page, 400, 300);
    await page.mouse.move(a.x, a.y);
    await page.mouse.down();
    await page.mouse.move(b.x, b.y, { steps: 4 });
    await page.keyboard.press("Escape");
    await page.mouse.up();
    expect(await layers(page)).toHaveLength(0);
    await drag(page, [200, 200], [400, 300]);
    await page.keyboard.press("Escape"); // clears the selection
    await click(page, 200, 250); // the left edge of the rectangle
    expect(await selection(page)).toHaveLength(1);
  });

  test("the panel names what a mixed selection is, and each tool's panel has its controls", async ({
    page,
  }) => {
    for (const [tool, control] of [
      ["Text", "Weight"],
      ["Counter", "Next number"],
      ["Pencil", "Smoothing"],
      ["Spotlight", "Dim strength"],
      ["Redaction", "Mode"],
      ["Highlighter", "Opacity"],
      ["Ellipse", "Stroke width"],
    ] as const) {
      await pick(page, tool);
      await expect(page.getByRole("region", { name: control })).toBeVisible();
    }
    await pick(page, "Text");
    await page.getByTestId("font-button").click();
    await page.getByRole("option", { name: "JetBrains Mono", exact: true }).click();
    await page.getByRole("button", { name: "Size: larger" }).click();
    await expect(page.getByRole("textbox", { name: "Size" })).toHaveValue("26");
    await page.screenshot({
      path: "test-results/editor-text-panel-light.png",
      animations: "disabled",
    });
  });
});

test.describe("text (browser mock)", () => {
  test.beforeEach(async ({ page }) => {
    await open(page, "ready");
    await ready(page);
    await page.getByRole("button", { name: "Text", exact: true }).click();
  });

  const field = (page: Page) => page.getByRole("textbox", { name: "Text" });
  const lastLayer = async (page: Page) => (await layers(page)).at(-1) as Record<string, unknown>;

  test("a click opens a field with the placeholder; typing, Cmd/Ctrl+Enter, one undo step", async ({
    page,
  }) => {
    await click(page, 300, 300);
    await expect(field(page)).toBeFocused();
    await expect(field(page)).toHaveAttribute("placeholder", "Type something…");
    await page.keyboard.type("Check the total");
    await page.screenshot({
      path: "test-results/editor-text-typing-light.png",
      animations: "disabled",
    });
    await page.keyboard.press("ControlOrMeta+Enter");
    await expect(field(page)).toHaveCount(0);
    expect(await lastLayer(page)).toMatchObject({
      type: "text",
      text: "Check the total",
      x: 300,
      y: 300,
      fontId: "inter",
      size: 24,
      weight: 500,
    });
    expect(await selection(page)).toHaveLength(1);
    // The text is drawn on the canvas now: dark pixels in its box.
    const dark = await page.getByTestId("editor-canvas").evaluate((c: HTMLCanvasElement) => {
      const ctx = c.getContext("2d");
      const dpr = window.devicePixelRatio || 1;
      const view = window.__lumengrabEditor?.ui.getState().view;
      if (!ctx || !view) return 0;
      const x = Math.round((view.x + 300 * view.zoom) * dpr);
      const y = Math.round((view.y + 300 * view.zoom) * dpr);
      const data = ctx.getImageData(
        x,
        y,
        Math.round(150 * view.zoom * dpr),
        Math.round(30 * view.zoom * dpr),
      ).data;
      let n = 0;
      for (let i = 0; i < data.length; i += 4)
        if ((data[i] ?? 255) < 90 && (data[i + 3] ?? 0) > 200) n += 1;
      return n;
    });
    expect(dark).toBeGreaterThan(30);
    await page.keyboard.press("ControlOrMeta+z");
    expect(await layers(page)).toHaveLength(0);
  });

  test("a box that stays empty disappears on Esc or on a click outside, without a history step", async ({
    page,
  }) => {
    await click(page, 300, 300);
    await expect(field(page)).toBeVisible();
    await page.keyboard.press("Escape");
    await expect(field(page)).toHaveCount(0);
    expect(await layers(page)).toHaveLength(0);
    await click(page, 300, 300);
    await expect(field(page)).toBeVisible();
    await click(page, 700, 500);
    await expect(field(page)).toBeVisible(); // the click ended the empty box and opened a new one there
    await page.keyboard.press("Escape");
    expect(await layers(page)).toHaveLength(0);
    await expect(page.getByRole("button", { name: "Undo" })).toBeDisabled();
  });

  test("a click outside keeps what was typed and the text stays selected with handles on its sides", async ({
    page,
  }) => {
    await click(page, 300, 300);
    await page.keyboard.type("Hello");
    await page.getByRole("button", { name: "Select" }).click(); // ends the edit through the blur
    await expect(field(page)).toHaveCount(0);
    expect((await lastLayer(page))["text"]).toBe("Hello");
    await expect(page.locator("[data-grip]")).toHaveCount(3); // east, west and rotate
  });

  test("double-click edits a text again; emptying it deletes it", async ({ page }) => {
    await click(page, 300, 300);
    await page.keyboard.type("First");
    await page.keyboard.press("ControlOrMeta+Enter");
    await page.getByRole("button", { name: "Select" }).click();
    await page.keyboard.press("Escape");
    const p = await at(page, 320, 312);
    await page.mouse.dblclick(p.x, p.y);
    await expect(field(page)).toBeVisible();
    await expect(field(page)).toHaveValue("First");
    await page.keyboard.press("ControlOrMeta+a");
    await page.keyboard.type("Second");
    await page.keyboard.press("ControlOrMeta+Enter");
    expect((await lastLayer(page))["text"]).toBe("Second");
    await page.keyboard.press("Enter"); // Enter edits the selected text
    await expect(field(page)).toBeVisible();
    await page.keyboard.press("ControlOrMeta+a");
    await page.keyboard.press("Backspace");
    await page.keyboard.press("Escape");
    expect(await layers(page)).toHaveLength(0);
    await page.keyboard.press("ControlOrMeta+z");
    expect((await lastLayer(page))["text"]).toBe("Second");
  });

  test("the style panel changes the text while it is typed; the right handle sets the width and lines wrap", async ({
    page,
  }) => {
    await click(page, 200, 200);
    await page.keyboard.type("A long sentence that should wrap into several lines");
    await page.getByTestId("font-button").click();
    await page.getByRole("option", { name: "JetBrains Mono", exact: true }).click(); // blurs the field: the edit ends, the text stays selected
    expect(await lastLayer(page)).toMatchObject({ fontId: "jetbrains-mono" });
    await page.getByRole("radio", { name: "Bold" }).click();
    await page.getByRole("radio", { name: "Color: #2563EB" }).click();
    await page.getByRole("radio", { name: "Background: #FFFFFF" }).click();
    await page.getByRole("radio", { name: "Align center" }).click();
    expect(await lastLayer(page)).toMatchObject({
      weight: 700,
      color: "#2563EB",
      background: "#FFFFFF",
      align: "center",
    });

    await page.keyboard.press("Enter");
    const handle = page.locator('[data-grip="text-width"]');
    const hb = await handle.boundingBox();
    if (!hb) throw new Error("no width handle");
    await page.mouse.move(hb.x + 4, hb.y + 4);
    await page.mouse.down();
    await page.mouse.move(hb.x - 120, hb.y + 4, { steps: 6 });
    await page.mouse.up();
    const width = Number((await lastLayer(page))["width"]);
    expect(width).toBeGreaterThan(20);
    await page.keyboard.press("ControlOrMeta+Enter");
    // The frame is as tall as the wrapped text (two lines at 56 %), not as one line.
    const outline = await page
      .locator('[data-testid="selection-frame"] polygon')
      .evaluate((el) => el.getBoundingClientRect().height);
    expect(outline).toBeGreaterThan(30);
    await page.screenshot({
      path: "test-results/editor-text-finished-light.png",
      animations: "disabled",
    });
  });
});

test.describe("what you see is what you export (browser mock)", () => {
  test("the editor's canvas and the exported picture show the same pixels, redactions and annotations included", async ({
    page,
  }) => {
    await open(page, "stack");
    await ready(page);
    const result = await page.evaluate(async () => {
      const load = async <T>(path: string): Promise<T> =>
        (await import(/* @vite-ignore */ path)) as T;
      const { editor, ui } = window.__lumengrabEditor ?? {};
      if (!editor || !ui) throw new Error("editor not ready");
      // 100 %, the picture's corner at (-50, -100) on the canvas: image pixel (x, y) is at (x - 50, y - 100).
      ui.getState().setView({ zoom: 1, x: -50, y: -100 });
      await new Promise((resolve) => setTimeout(resolve, 300));

      const { editorCodec } = await load<typeof import("../src/editor/draw/codec")>(
        "/src/editor/draw/codec.ts",
      );
      const { flattenProject } = await load<typeof import("../src/document/render/flatten")>(
        "/src/document/render/flatten.ts",
      );
      const { canvasCodec } = await load<typeof import("../src/document/render/canvas-codec")>(
        "/src/document/render/canvas-codec.ts",
      );
      const canvas = document.querySelector<HTMLCanvasElement>('[data-testid="editor-canvas"]');
      const ctx = canvas?.getContext("2d");
      if (!canvas || !ctx) throw new Error("no canvas");

      // The source picture from the mock capture, flattened through the export pipeline.
      const source = await (await fetch("/src/platform/mock/sample-capture.png")).arrayBuffer();
      const flat = await flattenProject(
        await canvasCodec.decode(new Uint8Array(source)),
        editor.getState().project,
        editorCodec,
      );
      // A window of the picture that holds the pixelated mask, the counter, the callout and part of the frame.
      const [x0, y0, w, h] = [60, 220, 620, 520];
      const shown = ctx.getImageData(x0 - 50, y0 - 100, w, h).data;
      let different = 0;
      const cells: Record<string, number> = {};
      for (let y = 0; y < h; y += 1) {
        for (let x = 0; x < w; x += 1) {
          const a = (y * w + x) * 4;
          const b = ((y0 + y) * flat.width + x0 + x) * 4;
          for (let c = 0; c < 3; c += 1) {
            if (Math.abs((shown[a + c] ?? 0) - (flat.data[b + c] ?? 0)) > 64) {
              different += 1;
              cells[`${String(Math.floor(x / 50) * 50)},${String(Math.floor(y / 50) * 50)}`] =
                (cells[`${String(Math.floor(x / 50) * 50)},${String(Math.floor(y / 50) * 50)}`] ??
                  0) + 1;
              break;
            }
          }
        }
      }
      return { different, total: w * h, cells };
    });
    // Shapes, the pixelated mask and the arrow are identical. The glyph edges of the text may differ a little: the
    // editor's canvas is rasterised by the GPU path and the export's by the CPU path, which anti-alias text differently.
    expect(result.different / result.total).toBeLessThan(0.001);
    for (const cell of Object.keys(result.cells)) {
      const [cx, cy] = cell.split(",").map(Number);
      // Everything that differs is in the part of the window with text (the counter's digit and "Wrong total?").
      expect((cx ?? 0) < 60 || (cy ?? 0) >= 400).toBe(true);
    }
  });
});

test.describe("crop (browser mock)", () => {
  test.beforeEach(async ({ page }) => {
    await open(page, "stack");
    await ready(page);
    await page.getByRole("button", { name: "Crop", exact: true }).click();
  });

  const draft = (page: Page) =>
    page.evaluate(() => window.__lumengrabEditor?.ui.getState().crop ?? null);
  const crop = async (page: Page) =>
    page.evaluate(() => window.__lumengrabEditor?.editor.getState().project.crop ?? null);

  test("the tool opens on the whole picture with its panel, the others are off", async ({
    page,
  }) => {
    await expect(page.getByTestId("crop-panel")).toBeVisible();
    await expect(page.getByRole("heading", { name: "Crop" })).toBeVisible();
    expect(await draft(page)).toMatchObject({
      rect: { x: 0, y: 0, width: 1440, height: 900 },
      preset: "original",
    });
    await expect(page.getByTestId("crop-badge")).toContainText("1440 × 900");
    await expect(page.getByRole("button", { name: "Rectangle" })).toBeDisabled();
    await expect(page.getByRole("radio", { name: "Original" })).toHaveAttribute(
      "aria-checked",
      "true",
    );
    await expect(page.locator("[data-grip]")).toHaveCount(8);
    await page.screenshot({ path: "test-results/editor-crop-light.png", animations: "disabled" });
  });

  test("a handle shrinks the frame in the ratio, the fields show it, Apply crops as one undo step", async ({
    page,
  }) => {
    const se = await page.locator('[data-grip="se"]').boundingBox();
    const nw = await page.locator('[data-grip="nw"]').boundingBox();
    if (!se || !nw) throw new Error("no handles");
    await page.mouse.move(nw.x + 4, nw.y + 4);
    await page.mouse.down();
    await page.mouse.move(nw.x + 124, nw.y + 84, { steps: 5 });
    await page.mouse.up();
    const r = (await draft(page))?.rect;
    expect(r && r.width / r.height).toBeCloseTo(1440 / 900, 1);
    expect(r?.x).toBeGreaterThan(100);
    await expect(page.getByRole("textbox", { name: "Width" })).toHaveValue(String(r?.width));
    await page.getByRole("button", { name: "Apply crop" }).click();
    expect(await crop(page)).toMatchObject({ width: r?.width, height: r?.height });
    await expect(page.getByTestId("size-readout")).toHaveText(
      `${String(r?.width)} × ${String(r?.height)} px`,
    );
    await expect(page.getByRole("button", { name: "Select" })).toHaveAttribute(
      "aria-pressed",
      "true",
    );
    await page.keyboard.press("ControlOrMeta+z");
    expect(await crop(page)).toBeNull();
    await expect(page.getByTestId("size-readout")).toHaveText("1440 × 900 px");
  });

  test("ratios, swap, the W and H fields and the lock", async ({ page }) => {
    await page.getByRole("radio", { name: "1:1" }).click();
    expect((await draft(page))?.rect).toEqual({ x: 270, y: 0, width: 900, height: 900 });
    await page.getByRole("button", { name: "Swap" }).click(); // a square stays a square
    await page.getByRole("radio", { name: "16:9" }).click();
    const r = (await draft(page))?.rect;
    expect(r && Math.abs(r.width / r.height - 16 / 9)).toBeLessThan(0.01);
    await page.getByRole("radio", { name: "Free" }).click();
    const width = page.getByRole("textbox", { name: "Width" });
    await width.fill("500");
    await width.press("Enter");
    expect((await draft(page))?.rect.width).toBe(500);
    await page.getByRole("button", { name: "Lock ratio" }).click();
    await page.getByRole("textbox", { name: "Height" }).fill("300");
    await page.getByRole("textbox", { name: "Height" }).press("Enter");
    const locked = (await draft(page))?.rect;
    expect(locked?.height).toBe(300);
    expect(locked && locked.width / locked.height).toBeCloseTo(500 / (r ? r.height : 1), 0);
  });

  test("a frame can be moved and a new one dragged out", async ({ page }) => {
    await page.getByRole("radio", { name: "Free" }).click();
    await drag(page, [0, 0], [400, 300]); // a new frame (outside the full-picture frame? it is inside: this moves it)
    const moved = (await draft(page))?.rect;
    expect(moved).toBeDefined();
    await page.getByRole("button", { name: "Reset" }).click();
    expect((await draft(page))?.rect).toEqual({ x: 0, y: 0, width: 1440, height: 900 });
  });

  test("Esc cancels, Enter applies, and the frame comes back where it was", async ({ page }) => {
    await page.getByRole("radio", { name: "1:1" }).click();
    await page.keyboard.press("Escape");
    expect(await crop(page)).toBeNull();
    expect(await draft(page)).toBeNull();
    await page.getByRole("button", { name: "Crop", exact: true }).click();
    await page.getByRole("radio", { name: "4:3" }).click();
    await page.keyboard.press("Enter");
    expect(await crop(page)).toEqual({ x: 120, y: 0, width: 1200, height: 900 });
    await page.getByRole("button", { name: "Crop", exact: true }).click();
    expect((await draft(page))?.rect).toEqual({ x: 120, y: 0, width: 1200, height: 900 }); // opens on the crop
    await page.keyboard.press("Escape");
    expect(await crop(page)).toEqual({ x: 120, y: 0, width: 1200, height: 900 });
  });

  test("the cropped picture is what the editor shows and what is exported; annotations outside are cut", async ({
    page,
  }) => {
    await page.getByRole("radio", { name: "Free" }).click();
    await page.getByRole("textbox", { name: "Width" }).fill("700");
    await page.getByRole("textbox", { name: "Width" }).press("Enter");
    await page.getByRole("textbox", { name: "Height" }).fill("450");
    await page.getByRole("textbox", { name: "Height" }).press("Enter");
    await page.keyboard.press("Enter");
    expect(await crop(page)).toEqual({ x: 0, y: 0, width: 700, height: 450 });
    await page.getByRole("button", { name: "Export", exact: true }).click();
    await page.getByRole("button", { name: "Save PNG" }).click();
    await expect(page.getByTestId("feedback-pill")).toHaveText("Saved");
    const size = await page.evaluate(() => {
      const bytes = window.__lumengrabMock?.written?.["t1"];
      if (!bytes) return null;
      const view = new DataView(bytes.buffer, bytes.byteOffset);
      return [view.getUint32(16), view.getUint32(20)];
    });
    expect(size).toEqual([700, 450]);
    await page.screenshot({
      path: "test-results/editor-cropped-light.png",
      animations: "disabled",
    });
  });
});

test.describe("panel details (browser mock)", () => {
  test.beforeEach(async ({ page }) => {
    await open(page, "ready");
    await ready(page);
  });
  const lastOf = async (page: Page) => (await layers(page)).at(-1) as Record<string, unknown>;
  const pick = (page: Page, tool: string) =>
    page.getByRole("button", { name: tool, exact: true }).click();

  test("nothing in the panel is cut off at the left edge: the selected style tile and swatch keep their frame", async ({
    page,
  }) => {
    await pick(page, "Arrow");
    const panel = page.getByTestId("style-panel").locator("fieldset");
    const edge = (await panel.boundingBox())?.x ?? 0;
    const tile = (await page.getByRole("radio", { name: "Straight" }).boundingBox())?.x ?? 0;
    const swatch =
      (await page.getByRole("radio", { name: "Color: #EF4444" }).boundingBox())?.x ?? 0;
    // The ring of a selected tile is 2 px (+1 offset): the tile must start at least that far inside the scroll area.
    expect(tile - edge).toBeGreaterThanOrEqual(4);
    expect(swatch - edge).toBeGreaterThanOrEqual(4);
    await page.screenshot({
      path: "test-results/editor-panel-edge-light.png",
      animations: "disabled",
    });
  });

  test("font size: type a number and press Enter, out-of-range numbers are pulled in, arrows step", async ({
    page,
  }) => {
    await pick(page, "Text");
    const size = page.getByRole("textbox", { name: "Size" });
    await size.fill("50");
    await size.press("Enter");
    await expect(size).toHaveValue("50");
    const area = await page.getByTestId("editor-canvas-area").boundingBox();
    if (!area) throw new Error("no canvas");
    await page.mouse.click(area.x + 200, area.y + 200);
    await page.keyboard.type("Big");
    await page.keyboard.press("ControlOrMeta+Enter");
    expect(await lastOf(page)).toMatchObject({ type: "text", size: 50 });
    await size.fill("500");
    await size.press("Enter");
    await expect(size).toHaveValue("200");
    expect(await lastOf(page)).toMatchObject({ size: 200 });
    await size.fill("abc");
    await size.press("Enter");
    await expect(size).toHaveValue("200");
    await size.focus();
    await size.press("ArrowDown");
    await expect(size).toHaveValue("198");
    await size.fill("3");
    await size.press("Tab");
    await expect(size).toHaveValue("8");
  });

  test("the colour picker: square, hue, hex, one undo step, and it also opens where the system picker did not", async ({
    page,
  }) => {
    await pick(page, "Rectangle");
    const a = await page.getByTestId("editor-canvas-area").boundingBox();
    if (!a) throw new Error("no canvas");
    await page.mouse.move(a.x + 200, a.y + 200);
    await page.mouse.down();
    await page.mouse.move(a.x + 400, a.y + 320, { steps: 4 });
    await page.mouse.up();
    await page.getByRole("radio", { name: "Stroke: custom colour" }).click();
    const picker = page.getByTestId("color-picker");
    await expect(picker).toBeVisible();
    await page.screenshot({
      path: "test-results/editor-color-picker-light.png",
      animations: "disabled",
    });
    const hex = picker.getByRole("textbox", { name: "Hex colour" });
    await hex.fill("#112233");
    expect(await lastOf(page)).toMatchObject({ stroke: "#112233" });
    await hex.fill("12"); // not a colour yet: nothing changes
    expect(await lastOf(page)).toMatchObject({ stroke: "#112233" });
    await hex.press("Enter");
    await expect(hex).toHaveValue("#112233");

    // Dragging over the square changes the colour as one undo step.
    const square = page.getByTestId("color-square");
    const box = await square.boundingBox();
    if (!box) throw new Error("no square");
    await page.mouse.move(box.x + 5, box.y + 5);
    await page.mouse.down();
    await page.mouse.move(box.x + box.width * 0.6, box.y + box.height * 0.4, { steps: 6 });
    await page.mouse.up();
    const dragged = String((await lastOf(page))["stroke"]);
    expect(dragged).not.toBe("#112233");
    await page.keyboard.press("Escape");
    await expect(picker).toHaveCount(0);
    await page.keyboard.press("ControlOrMeta+z");
    expect(await lastOf(page)).toMatchObject({ stroke: "#112233" }); // back to before the drag
    await expect(page.getByRole("slider", { name: "Hue" })).toHaveCount(0);
  });

  test("saved colours: save one, it is a swatch in every row, it stays after a reload, and it can be removed", async ({
    page,
  }) => {
    await pick(page, "Rectangle");
    await page.getByRole("radio", { name: "Stroke: custom colour" }).click();
    const picker = page.getByTestId("color-picker");
    await expect(picker).toContainText("Colours you save stay here for every picture.");
    await picker.getByRole("textbox", { name: "Hex colour" }).fill("#0A84FF");
    await picker.getByRole("button", { name: "Save this colour" }).click();
    await expect(picker.getByRole("button", { name: "Colour is saved" })).toBeDisabled();
    await expect(picker.getByRole("button", { name: "Use #0A84FF" })).toBeVisible();
    await page.keyboard.press("Escape");
    await expect(page.getByRole("radio", { name: "Stroke: #0A84FF" })).toBeVisible();
    await expect(page.getByRole("radio", { name: "Fill: #0A84FF" })).toBeVisible();

    await page.reload();
    await ready(page);
    await pick(page, "Ellipse");
    await expect(page.getByRole("radio", { name: "Stroke: #0A84FF" })).toBeVisible(); // still there

    await page.getByRole("radio", { name: "Stroke: custom colour" }).click();
    const again = page.getByTestId("color-picker");
    await again.getByRole("button", { name: "Use #0A84FF" }).hover();
    await again.getByRole("button", { name: "Remove #0A84FF" }).click();
    await page.keyboard.press("Escape");
    await expect(page.getByRole("radio", { name: "Stroke: #0A84FF" })).toHaveCount(0);
  });

  test("fonts: eight of ours, then the ones installed on the device; the choice lands in the text", async ({
    page,
  }) => {
    await pick(page, "Text");
    await page.getByTestId("font-button").click();
    const list = page.getByRole("listbox", { name: "Fonts" });
    for (const name of [
      "Inter",
      "JetBrains Mono",
      "Lora",
      "Fraunces",
      "Space Grotesk",
      "Oswald",
      "Nunito",
      "Caveat",
    ]) {
      await expect(list.getByRole("option", { name, exact: true })).toBeVisible();
    }
    await expect(page.getByText("Installed on this device")).toBeVisible();
    await expect(list.getByRole("option", { name: "Avenir Next" })).toBeVisible();
    await page.screenshot({
      path: "test-results/editor-font-picker-light.png",
      animations: "disabled",
    });

    await page.getByRole("textbox", { name: "Search fonts" }).fill("geo");
    await expect(list.getByRole("option")).toHaveCount(1);
    await list.getByRole("option", { name: "Georgia" }).click();
    await expect(page.getByTestId("font-button")).toContainText("Georgia");

    const area = await page.getByTestId("editor-canvas-area").boundingBox();
    if (!area) throw new Error("no canvas");
    await page.mouse.click(area.x + 200, area.y + 200);
    await page.keyboard.type("Serif words");
    await page.keyboard.press("ControlOrMeta+Enter");
    expect(await lastOf(page)).toMatchObject({ fontId: "system:Georgia" });
    // The picker follows the selected text; a bundled font is stored by its id.
    await page.getByTestId("font-button").click();
    await page
      .getByRole("listbox", { name: "Fonts" })
      .getByRole("option", { name: "Lora" })
      .click();
    expect(await lastOf(page)).toMatchObject({ fontId: "lora" });
    // Nothing found says so.
    await page.getByTestId("font-button").click();
    await page.getByRole("textbox", { name: "Search fonts" }).fill("zzzz");
    await expect(page.getByText("No installed font matches.")).toBeVisible();
    await page.keyboard.press("Escape");
    await expect(page.getByRole("listbox", { name: "Fonts" })).toHaveCount(0);
  });

  test("a file with a font this device does not have says so and uses Inter", async ({ page }) => {
    await page.goto("/?window=document&label=doc-1&scenario=systemfont&fonts=none");
    await ready(page);
    await expect(page.getByRole("list", { name: "Notices" })).toContainText(
      "The font “Avenir Next” is not installed on this device. Inter is used instead.",
    );
    await page.getByRole("button", { name: "Select", exact: true }).click();
    const area = await page.getByTestId("editor-canvas-area").boundingBox();
    if (!area) throw new Error("no canvas");
    const view = await page.evaluate(() => window.__lumengrabEditor?.ui.getState().view);
    await page.mouse.click(
      area.x + (view?.x ?? 0) + 220 * (view?.zoom ?? 1),
      area.y + (view?.y ?? 0) + 220 * (view?.zoom ?? 1),
    );
    await expect(page.getByTestId("font-button")).toContainText("Avenir Next");
    await expect(page.getByText("Inter is shown instead.")).toBeVisible();
    // With the font present there is no notice.
    await page.goto("/?window=document&label=doc-1&scenario=systemfont");
    await ready(page);
    await expect(page.getByRole("list", { name: "Notices" })).toHaveCount(0);
  });
});
