import { expect, test, type Page } from "@playwright/test";
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
    await row("one").dragTo(row("frame"), { targetPosition: { x: 100, y: 30 } }); // below the frame: to the back
    expect((await layers(page)).map((l) => l.id)).toEqual(["one", "frame", "callout", "mask"]);
    await row("mask").dragTo(row("callout"), { targetPosition: { x: 100, y: 18 } }); // into the group
    const group = (await layers(page)).find((l) => l.id === "callout") as unknown as {
      layers: { id: string }[];
    };
    expect(group.layers.map((l) => l.id)).toEqual(["box", "pointer", "note", "mask"]);
    await page.keyboard.press("ControlOrMeta+z");
    await page.keyboard.press("ControlOrMeta+z");
    expect((await layers(page)).map((l) => l.id)).toEqual(["frame", "callout", "mask", "one"]);
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
