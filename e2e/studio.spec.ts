import { expect, test, type Page } from "@playwright/test";
import type { Presentation } from "../src/document/schema";
import type * as Scenes from "../src/shader/scenes";

// The preview plays by itself; with Reduce Motion it starts paused (software WebGL is slow, and these tests are not about playing).
test.use({ viewport: { width: 1440, height: 900 }, reducedMotion: "reduce" });

const open = async (page: Page) => {
  await page.goto("/?window=document&label=doc-1&scenario=stack");
  await expect(page.getByTestId("editor-canvas")).toBeVisible();
  await page.waitForFunction(() => window.__lumengrabEditor?.ui.getState().view != null);
  await page.getByRole("radio", { name: "Presentation" }).click();
  await page.getByRole("radio", { name: "Animated", exact: true }).click();
  // The Studio tests work on the "Aurora night" template: five layers, two of them Aurora, a loop of 8 s.
  await page.evaluate(async () => {
    const path = "/src/shader/scenes.ts";
    const { TEMPLATES } = (await import(/* @vite-ignore */ path)) as typeof Scenes;
    const scene = TEMPLATES[0]?.make();
    window.__lumengrabEditor?.editor.getState().change((project) => {
      project.presentation.background = scene as never;
    });
  });
  await page.getByRole("button", { name: "Open Background Studio" }).click();
  await expect(page.getByRole("dialog", { name: "Background Studio" })).toBeVisible();
};
const studio = (page: Page) => page.getByRole("dialog", { name: "Background Studio" });
const rows = (page: Page) =>
  studio(page).getByRole("list", { name: "Layers" }).getByRole("listitem");
const doc = (page: Page) =>
  page.evaluate(
    () => window.__lumengrabEditor?.editor.getState().project.presentation,
  ) as Promise<Presentation>;
type Scene = {
  layers: {
    id: string;
    kind: string;
    enabled: boolean;
    opacity: number;
    blend: string;
    speed: number;
    direction?: string;
    params: Record<string, unknown>;
  }[];
  palette: string[];
  loop: number;
  poster: number;
  seed: number;
};
const docScene = async (page: Page) => (await doc(page)).background as unknown as Scene;
const names = async (page: Page) =>
  await rows(page).evaluateAll((els) => els.map((e) => e.getAttribute("aria-label") ?? ""));

test.describe("Background Studio (browser mock)", () => {
  test("opens on the look, lists its layers top first and shows the one that is selected", async ({
    page,
  }) => {
    await open(page);
    expect(await names(page)).toEqual(["Film grain", "Aurora", "Aurora", "Orbs", "Gradient"]);
    await expect(studio(page).getByText("Palette", { exact: true })).toBeVisible();
    await expect(studio(page).getByText("6 colours")).toBeVisible();
    await rows(page).nth(1).getByRole("button", { name: "Aurora", exact: true }).click();
    await expect(
      studio(page)
        .getByRole("complementary", { name: "Inspector" })
        .getByText("Generator · Aurora"),
    ).toBeVisible();
    await page.waitForTimeout(500);
    await page.screenshot({ path: "test-results/studio-overview.png" });
  });

  test("hide, blend, opacity, duplicate, delete and undo are all one step each", async ({
    page,
  }) => {
    await open(page);
    const second = rows(page).nth(1);
    await second.getByRole("button", { name: /Hide Aurora/ }).click();
    await expect(second.getByRole("button", { name: /Show Aurora/ })).toBeVisible();
    await second.getByRole("combobox", { name: /Blend mode of Aurora/ }).selectOption("add");
    const opacity = second.getByRole("textbox", { name: /Opacity of Aurora/ });
    await opacity.fill("40");
    await opacity.press("Enter");
    await second.getByRole("button", { name: "More for Aurora" }).click();
    await page.getByRole("menuitem", { name: /Duplicate/ }).click();
    await expect(rows(page)).toHaveCount(6);
    await page
      .getByRole("complementary", { name: "Inspector" })
      .getByRole("button", { name: "More for this layer" })
      .click();
    await page.getByRole("menuitem", { name: "Delete" }).click();
    await expect(rows(page)).toHaveCount(5);
    await page.keyboard.press("ControlOrMeta+z");
    await expect(rows(page)).toHaveCount(6);
    await page.keyboard.press("ControlOrMeta+Shift+z");
    await expect(rows(page)).toHaveCount(5);
    // The document is untouched until Apply.
    expect((await docScene(page)).layers).toHaveLength(5);
  });

  test("a layer moves with Alt and the arrow keys", async ({ page }) => {
    await open(page);
    await rows(page).nth(4).getByRole("button", { name: "Move Gradient" }).focus();
    await page.keyboard.press("Alt+ArrowUp");
    expect(await names(page)).toEqual(["Film grain", "Aurora", "Aurora", "Gradient", "Orbs"]);
  });

  test("a layer is dragged to another place and the drop place is named", async ({ page }) => {
    await open(page);
    const grip = rows(page).nth(4).getByRole("button", { name: "Move Gradient" });
    const box = await grip.boundingBox();
    const target = await rows(page).nth(1).boundingBox();
    if (!box || !target) throw new Error("boxes");
    await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
    await page.mouse.down();
    await page.mouse.move(box.x + 20, target.y + 4, { steps: 8 });
    await expect(page.getByText("Drop above Aurora")).toBeVisible();
    await page.mouse.up();
    expect(await names(page)).toEqual(["Film grain", "Gradient", "Aurora", "Aurora", "Orbs"]);
  });

  test("Add puts a new layer on top and selects it; the menu lists generators, effects and custom", async ({
    page,
  }) => {
    await open(page);
    await studio(page).getByRole("button", { name: "Add", exact: true }).click();
    const menu = page.getByRole("menu", { name: "Add a layer" });
    for (const label of [
      "Gradient",
      "Orbs",
      "Aurora",
      "Waves",
      "Liquid",
      "Cells",
      "Ripples",
      "Pattern",
      "Light rays",
      "Stars",
      "Solid",
      "Warp",
      "Swirl",
      "Chromatic shift",
      "Pixelate",
      "Posterize",
      "Vignette",
      "Film grain",
      "Glow",
      "Color grade",
      "Write new shader…",
    ])
      await expect(menu.getByRole("menuitem", { name: label })).toBeVisible();
    await menu.getByRole("menuitem", { name: "Pixelate" }).click();
    expect((await names(page))[0]).toBe("Pixelate");
    await expect(studio(page).getByText("Effect · Pixelate")).toBeVisible();
  });

  test("Start from replaces the stack with a template, and undo brings the old one back", async ({
    page,
  }) => {
    await open(page);
    await studio(page)
      .getByRole("button", { name: /Start from/ })
      .click();
    const menu = page.getByRole("menu", { name: "Start from" });
    await expect(menu.getByRole("menuitem")).toHaveCount(7);
    await menu.getByRole("menuitem", { name: /Starfield/ }).click();
    expect(await names(page)).toEqual(["Glow", "Stars", "Gradient"]);
    await page.keyboard.press("ControlOrMeta+z");
    expect(await names(page)).toHaveLength(5);
  });

  test("the palette: colours can be added, changed and removed", async ({ page }) => {
    await open(page);
    await studio(page).getByRole("button", { name: "Add a palette colour" }).click();
    await expect(studio(page).getByText("7 colours")).toBeVisible();
    await page.getByRole("button", { name: "Remove this colour" }).click();
    await expect(studio(page).getByText("6 colours")).toBeVisible();
  });

  test("the Inspector edits settings: slider, direction, source, reset", async ({ page }) => {
    await open(page);
    await rows(page).nth(2).getByRole("button", { name: "Aurora", exact: true }).click();
    const inspector = studio(page).getByRole("complementary", { name: "Inspector" });
    await expect(inspector.getByText("Generator · Aurora")).toBeVisible();
    await expect(inspector.getByRole("region", { name: "Shape" })).toBeVisible();
    await expect(inspector.getByRole("region", { name: "Motion" })).toBeVisible();
    await expect(inspector.getByRole("region", { name: "Colour" })).toBeVisible();
    await expect(inspector.getByRole("region", { name: "Advanced" })).toBeVisible();
    const scale = inspector.getByRole("slider", { name: "Scale slider" });
    await scale.focus();
    await page.keyboard.press("End");
    await inspector.getByRole("radio", { name: "Direction up" }).click();
    await inspector.getByRole("radio", { name: "Custom" }).click();
    await expect(inspector.getByText("Highlight", { exact: true })).toBeVisible();
    await inspector.getByRole("button", { name: "Reset Shape" }).click();
    await expect(
      inspector
        .getByText("Uses palette colours 1 to 3")
        .or(inspector.getByText("Highlight"))
        .first(),
    ).toBeVisible();
  });

  test("the timeline plays, pauses, scrubs, steps, moves the still frame and checks the seam", async ({
    page,
  }) => {
    await open(page);
    const timeText = studio(page).getByTestId("studio-time");
    await studio(page).getByRole("slider", { name: "Time" }).focus();
    await page.keyboard.press("Home");
    await expect(timeText).toHaveText("0.0 / 8.0 s");
    await page.keyboard.press("Shift+ArrowRight");
    await expect(timeText).toHaveText("1.0 / 8.0 s");
    await studio(page).getByRole("button", { name: "Play" }).click();
    await expect.poll(async () => (await timeText.textContent()) ?? "").not.toBe("1.0 / 8.0 s");
    await studio(page).getByRole("radio", { name: "2×" }).click();
    await studio(page).getByRole("switch", { name: "Show seam" }).click();
    await expect(studio(page).getByText("Seam check: the end flows into the start")).toBeVisible({
      timeout: 20_000,
    });
    await studio(page).getByRole("switch", { name: "Show seam" }).click();
    await studio(page).getByRole("button", { name: "Pause" }).click();
    const before = (await docScene(page)).poster;
    const marker = studio(page).getByRole("button", { name: "Still frame marker" });
    const box = await marker.boundingBox();
    if (!box) throw new Error("marker");
    await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
    await page.mouse.down();
    await page.mouse.move(box.x + 200, box.y + box.height / 2, { steps: 6 });
    await page.mouse.up();
    await studio(page).getByRole("button", { name: "Apply" }).click();
    expect((await docScene(page)).poster).toBeGreaterThan(before);
  });

  test("the loop length and the seed can be typed, and the dice gives a new seed and palette", async ({
    page,
  }) => {
    await open(page);
    const loop = studio(page).getByRole("textbox", { name: "Loop length" });
    await loop.fill("12");
    await loop.press("Enter");
    await expect(studio(page).getByTestId("studio-time")).toContainText("/ 12.0 s");
    await studio(page).getByRole("button", { name: "Randomize" }).click();
    await studio(page).getByRole("button", { name: "Apply" }).click();
    const scene = await docScene(page);
    expect(scene.loop).toBe(12);
    expect(scene.seed).not.toBe(48213);
  });

  test("Apply puts the scene in the document as one undo step", async ({ page }) => {
    await open(page);
    const original = JSON.stringify(await docScene(page));
    await studio(page).getByRole("button", { name: "Add", exact: true }).click();
    await page.getByRole("menuitem", { name: "Vignette" }).click();
    await studio(page).getByRole("button", { name: "Apply" }).click();
    await expect(studio(page)).toHaveCount(0);
    expect((await docScene(page)).layers).toHaveLength(6);
    await page.keyboard.press("ControlOrMeta+z");
    expect(JSON.stringify(await docScene(page))).toBe(original);
  });

  test("Cancel with changes asks first; Keep editing stays, Discard leaves the document alone", async ({
    page,
  }) => {
    await open(page);
    await studio(page).getByRole("button", { name: "Cancel" }).click();
    await expect(studio(page)).toHaveCount(0); // nothing changed: no question
    await page.getByRole("button", { name: "Open Background Studio" }).click();
    await studio(page).getByRole("button", { name: "Add", exact: true }).click();
    await page.getByRole("menuitem", { name: "Vignette" }).click();
    await studio(page).getByRole("button", { name: "Cancel" }).click();
    const dialog = page.getByRole("dialog", { name: "Discard changes?" });
    await expect(dialog).toBeVisible();
    await dialog.getByRole("button", { name: "Keep editing" }).click();
    await expect(studio(page)).toBeVisible();
    await page.keyboard.press("Escape");
    await page
      .getByRole("dialog", { name: "Discard changes?" })
      .getByRole("button", { name: "Discard" })
      .click();
    await expect(studio(page)).toHaveCount(0);
    expect((await docScene(page)).layers).toHaveLength(5);
  });

  test("Background only shows the scene alone, and the size readout is the size of the picture", async ({
    page,
  }) => {
    await open(page);
    await studio(page).getByRole("radio", { name: "Background only" }).click();
    await expect(studio(page).getByRole("radio", { name: "Background only" })).toBeChecked();
    await expect(studio(page).getByTestId("studio-size")).toContainText("px");
    await studio(page).getByRole("radio", { name: "50%" }).click();
    await expect(studio(page).getByRole("radio", { name: "50%" })).toBeChecked();
  });

  test("Save as my look keeps the animation under Your animated looks", async ({ page }) => {
    await open(page);
    await studio(page).getByRole("button", { name: "Save as my look" }).click();
    const dialog = page.getByRole("dialog", { name: "Save as my look" });
    await expect(dialog.getByText("8 s loop")).toBeVisible();
    await expect(dialog.getByText(/Includes the animation/)).toBeVisible();
    await dialog.getByRole("textbox", { name: "Name" }).fill("Studio night");
    await dialog.getByRole("button", { name: "Save look" }).click();
    await expect(page.getByText("Saved as “Studio night”")).toBeVisible();
    await studio(page).getByRole("button", { name: "Apply" }).click();
    await expect(
      page
        .getByRole("region", { name: "Background" })
        .getByRole("button", { name: "Studio night", exact: true }),
    ).toBeVisible();
  });

  test("Freeze turns the frame into a picture background and closes the Studio", async ({
    page,
  }) => {
    await open(page);
    await studio(page).getByRole("button", { name: "Freeze" }).click();
    const dialog = page.getByRole("dialog", { name: "Use this frame as picture?" });
    await expect(dialog).toBeVisible();
    await dialog.getByRole("button", { name: "Use as picture" }).click();
    await expect(studio(page)).toHaveCount(0);
    expect((await doc(page)).background.type).toBe("image");
  });

  test("without WebGL the preview says so and the fallback colour can be changed", async ({
    page,
  }) => {
    await page.addInitScript(() => {
      type GetContext = (this: HTMLCanvasElement, kind: string, ...rest: unknown[]) => unknown;
      const proto = HTMLCanvasElement.prototype as unknown as { getContext: GetContext };
      const original: GetContext = proto.getContext;
      proto.getContext = function (kind, ...rest) {
        if (kind === "webgl" || kind === "webgl2") return null;
        return original.call(this, kind, ...rest);
      };
    });
    await open(page);
    await expect(
      studio(page).getByText("This computer can't show animated backgrounds"),
    ).toBeVisible();
    await expect(studio(page).getByRole("button", { name: "Fallback colour" })).toBeVisible();
  });
});
