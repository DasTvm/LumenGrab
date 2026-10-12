import { expect, test, type Page } from "@playwright/test";
import type { Presentation } from "../src/document/schema";

test.use({ viewport: { width: 1280, height: 880 } });

const open = async (page: Page) => {
  await page.goto("/?window=document&label=doc-1&scenario=stack");
  await expect(page.getByTestId("editor-canvas")).toBeVisible();
  await page.waitForFunction(() => window.__lumengrabEditor?.ui.getState().view != null);
};
const presentation = (page: Page) =>
  page.evaluate(
    () => window.__lumengrabEditor?.editor.getState().project.presentation,
  ) as Promise<Presentation>;
const toPresentation = async (page: Page) => {
  await page.getByRole("radio", { name: "Presentation" }).click();
  await expect(page.getByTestId("presentation-panel")).toBeVisible();
};

test.describe("presentation mode (browser mock)", () => {
  test("the Presentation tab applies the default look, shows the panel and hides the tool rail", async ({
    page,
  }) => {
    await open(page);
    await expect(page.getByRole("navigation", { name: "Tools" })).toBeVisible();
    expect((await presentation(page)).enabled).toBe(false);
    await toPresentation(page);
    const p = await presentation(page);
    expect(p.enabled).toBe(true);
    expect(p.background.type).toBe("gradient"); // Midnight
    await expect(page.getByRole("navigation", { name: "Tools" })).toHaveCount(0);
    await expect(page.getByTestId("size-readout")).toContainText("px");
    await page.screenshot({
      path: "test-results/presentation-panel-light.png",
      animations: "disabled",
    });
    // One undo step undoes the look; Annotate brings the tools back.
    await page.getByRole("radio", { name: "Annotate" }).click();
    await expect(page.getByRole("navigation", { name: "Tools" })).toBeVisible();
  });

  test("a look applies at once and one undo takes it back", async ({ page }) => {
    await open(page);
    await toPresentation(page);
    await page.getByRole("button", { name: "Citrus", exact: true }).click();
    let p = await presentation(page);
    expect(p.background).toMatchObject({ type: "gradient", angle: 150 });
    await expect(page.getByRole("button", { name: "Citrus", exact: true })).toHaveAttribute(
      "aria-pressed",
      "true",
    );
    await page.keyboard.press("ControlOrMeta+z");
    p = await presentation(page);
    expect((p.background as { stops: { color: string }[] }).stops[0]?.color).toBe("#0F172A");
  });

  test("every background type can be chosen and edited", async ({ page }) => {
    await open(page);
    await toPresentation(page);
    const type = (name: string) => page.getByRole("radio", { name, exact: true });

    await type("Solid").click();
    await page.getByLabel("Hex").fill("#336699");
    await page.getByLabel("Hex").blur();
    expect((await presentation(page)).background).toEqual({ type: "solid", color: "#336699" });

    await type("Gradient").click();
    expect((await presentation(page)).background.type).toBe("gradient");
    await page.getByRole("radio", { name: "Radial" }).click();
    expect((await presentation(page)).background).toMatchObject({ kind: "radial" });
    const stops = async () =>
      ((await presentation(page)).background as { stops: unknown[] }).stops.length;
    const before = await stops();
    await page.getByRole("button", { name: "Add a colour" }).click();
    expect(await stops()).toBe(before + 1);
    await page.getByRole("button", { name: "Remove this colour" }).click();
    expect(await stops()).toBe(before);
    await page.getByRole("button", { name: "Reverse the colours" }).click();

    await type("Mesh").click();
    const mesh = (await presentation(page)).background as { type: string; colors: string[] };
    expect(mesh.type).toBe("mesh");
    expect(mesh.colors).toHaveLength(9);
    await page.getByRole("radio", { name: "4 × 4" }).click();
    expect(((await presentation(page)).background as { colors: string[] }).colors).toHaveLength(16);
    await page.getByRole("button", { name: "Shuffle the mesh" }).click();
    await page.screenshot({ path: "test-results/presentation-mesh.png", animations: "disabled" });

    await type("Image").click();
    await page.getByTestId("image-drop").click();
    await expect(page.getByAltText("Background picture")).toBeVisible();
    const image = (await presentation(page)).background as { type: string; asset: string };
    expect(image.type).toBe("image");
    expect(image.asset).toMatch(/^[0-9a-f]{64}\.png$/);
    await page.getByRole("radio", { name: "Contain" }).click();
    expect((await presentation(page)).background).toMatchObject({ fit: "contain" });

    await type("Blur").click();
    expect((await presentation(page)).background).toMatchObject({ type: "source-blur", blur: 40 });
    await page.getByRole("slider", { name: "Zoom" }).fill("200");
    expect((await presentation(page)).background).toMatchObject({ zoom: 2 });
  });

  test("padding: the slider, the four edges, auto-balance and Balance edges", async ({ page }) => {
    await open(page);
    await toPresentation(page);
    await page.getByRole("slider", { name: "Padding" }).fill("100");
    expect((await presentation(page)).padding).toEqual({
      top: 100,
      right: 100,
      bottom: 100,
      left: 100,
    });
    // With auto-balance on, one edge moves all four.
    const top = page.getByLabel("Padding top");
    await top.fill("40");
    await top.blur();
    expect((await presentation(page)).padding).toEqual({
      top: 40,
      right: 40,
      bottom: 40,
      left: 40,
    });
    // Off: the edges are independent, and Balance edges makes them equal again.
    await page.getByRole("switch", { name: "Auto-balance" }).click();
    await page.getByLabel("Padding left").fill("80");
    await page.getByLabel("Padding left").blur();
    expect((await presentation(page)).padding).toEqual({
      top: 40,
      right: 40,
      bottom: 40,
      left: 80,
    });
    await page.getByRole("button", { name: "Balance edges" }).click();
    expect((await presentation(page)).padding).toEqual({
      top: 50,
      right: 50,
      bottom: 50,
      left: 50,
    });
    await expect(page.getByRole("button", { name: "Balance edges" })).toBeDisabled();
  });

  test("corner radius, shadow presets and the shadow switch", async ({ page }) => {
    await open(page);
    await toPresentation(page);
    await page.getByRole("slider", { name: "Corner radius" }).fill("40");
    expect((await presentation(page)).cornerRadius).toBe(40);
    await page.getByRole("radio", { name: "Hard" }).click();
    const width = await page.evaluate(
      () => window.__lumengrabEditor?.ui.getState().imageSize.width ?? 0,
    );
    expect((await presentation(page)).shadow.blur).toBeCloseTo(12 * (width / 1280), 1);
    await expect(page.getByRole("radio", { name: "Hard" })).toHaveAttribute("aria-checked", "true");
    await page.getByLabel("Shadow blur").fill("77");
    await expect(
      page
        .getByRole("radiogroup", { name: "Shadow preset" })
        .getByRole("radio", { name: "Custom" }),
    ).toHaveAttribute("aria-checked", "true");
    await page.getByRole("switch", { name: "Shadow" }).click();
    expect((await presentation(page)).shadow.enabled).toBe(false);
    await expect(page.getByLabel("Shadow blur")).toHaveCount(0);
  });

  test("window frames with title, address and theme", async ({ page }) => {
    await open(page);
    await toPresentation(page);
    await page.getByRole("radio", { name: "Browser" }).click();
    await page.getByLabel("Title", { exact: true }).fill("Checkout");
    await page.getByLabel("URL").fill("lumengrab.app/checkout");
    await page.getByRole("radio", { name: "Dark" }).click();
    expect((await presentation(page)).frame).toEqual({
      type: "browser",
      title: "Checkout",
      url: "lumengrab.app/checkout",
      theme: "dark",
    });
    await page.getByRole("radio", { name: "Terminal" }).click();
    await expect(page.getByRole("radio", { name: "Dark" })).toHaveCount(0); // a terminal is always dark
    await page.getByRole("radio", { name: "None" }).click();
    await expect(page.getByLabel("Title", { exact: true })).toHaveCount(0);
  });

  test("aspect ratios, a custom ratio and the social formats with their exact output size", async ({
    page,
  }) => {
    await open(page);
    await toPresentation(page);
    const output = page.getByTestId("output-size");
    await page.getByRole("radio", { name: "1:1", exact: true }).click();
    expect((await presentation(page)).aspect).toEqual({ mode: "fixed", ratio: [1, 1] });
    const aspects = page.getByRole("radiogroup", { name: "Aspect ratio" });
    await aspects.getByRole("radio", { name: "Custom" }).click();
    await page.getByLabel("Custom ratio").fill("7:3");
    await page.getByLabel("Custom ratio").blur();
    expect((await presentation(page)).aspect).toEqual({ mode: "fixed", ratio: [7, 3] });
    await aspects.getByRole("radio", { name: "Auto" }).click();
    expect((await presentation(page)).aspect).toEqual({ mode: "free" });

    await page.getByRole("tab", { name: "Social" }).click();
    await page.getByRole("radio", { name: /Story/ }).first().click();
    expect((await presentation(page)).aspect).toEqual({
      mode: "fixed",
      ratio: [1080, 1920],
      size: [1080, 1920],
      preset: "instagram-story",
    });
    await expect(output).toContainText("1080 × 1920 px");
    await expect(page.getByTestId("size-readout")).toContainText("1080 × 1920 px");
    await page.getByRole("switch", { name: "Show safe area" }).click();
    await expect(page.getByTestId("safe-area")).toBeVisible();
    await page.screenshot({ path: "test-results/presentation-social.png", animations: "disabled" });
    // The Export dialog offers the finished size.
    await page.keyboard.press("ControlOrMeta+e");
    await expect(page.getByRole("dialog")).toContainText("1080");
  });

  test("Remove the presentation turns it off, Annotate shows the plain picture again", async ({
    page,
  }) => {
    await open(page);
    await toPresentation(page);
    await page.getByRole("button", { name: "Remove the presentation" }).click();
    expect((await presentation(page)).enabled).toBe(false);
    await expect(page.getByRole("status")).toContainText("The presentation is off");
    await page.getByRole("button", { name: "Paper", exact: true }).click();
    expect((await presentation(page)).enabled).toBe(true);
  });

  test("Ctrl/Cmd+Shift+P switches the mode and tools are off in Presentation mode", async ({
    page,
  }) => {
    await open(page);
    await page.keyboard.press("ControlOrMeta+Shift+p");
    await expect(page.getByTestId("presentation-panel")).toBeVisible();
    await page.keyboard.press("r"); // no tool in this mode
    expect(await page.evaluate(() => window.__lumengrabEditor?.ui.getState().tool)).toBe("select");
    await page.keyboard.press("ControlOrMeta+Shift+p");
    await expect(page.getByTestId("presentation-panel")).toHaveCount(0);
  });

  test("save the current settings as my look, and it is there after a reload", async ({ page }) => {
    await open(page);
    await toPresentation(page);
    await expect(page.getByText("Save the current background, padding and frame")).toBeVisible();
    await page.getByRole("button", { name: "Save as my look" }).first().click();
    const dialog = page.getByRole("dialog", { name: "Save as my look" });
    await expect(dialog).toBeVisible();
    await page.screenshot({
      path: "test-results/presentation-save-look.png",
      animations: "disabled",
    });
    await dialog.getByLabel("Name").fill("Client demo");
    await dialog.getByRole("checkbox", { name: "Window frame" }).click(); // leave the frame out
    await dialog.getByRole("button", { name: "Save look" }).click();
    await expect(page.getByTestId("toasts")).toContainText("Saved as “Client demo”");
    await expect(page.getByRole("button", { name: "Client demo", exact: true })).toBeVisible();
    const stored = await page.evaluate(() => window.localStorage.getItem("lumengrab.mock.looks"));
    const file = JSON.parse(stored ?? "{}") as {
      looks: { name: string; parts: Record<string, unknown> }[];
    };
    expect(file.looks.map((l) => l.name)).toEqual(["Client demo"]);
    expect(Object.keys(file.looks[0]?.parts ?? {}).sort()).toEqual([
      "background",
      "cornerRadius",
      "padding",
      "shadow",
    ]);

    await page.reload();
    await expect(page.getByTestId("editor-canvas")).toBeVisible();
    await toPresentation(page);
    await expect(page.getByRole("button", { name: "Client demo", exact: true })).toBeVisible();
  });

  test("a look is applied with its own padding scaled to the picture, and a name that is taken asks first", async ({
    page,
  }) => {
    await open(page);
    await toPresentation(page);
    await page.getByRole("slider", { name: "Padding" }).fill("128");
    await page.getByRole("button", { name: "Save as my look" }).first().click();
    const dialog = page.getByRole("dialog", { name: "Save as my look" });
    await dialog.getByLabel("Name").fill("Wide");
    await dialog.getByRole("button", { name: "Save look" }).click();
    await page.getByRole("button", { name: "Citrus", exact: true }).click();
    await page.getByRole("slider", { name: "Padding" }).fill("10");
    await page.getByRole("button", { name: "Wide", exact: true }).click();
    expect((await presentation(page)).padding.top).toBe(128);

    await page.getByRole("button", { name: "Save current" }).click();
    const again = page.getByRole("dialog", { name: "Save as my look" });
    await again.getByLabel("Name").fill("wide");
    await again.getByRole("button", { name: "Save look" }).click();
    const replace = page.getByRole("dialog", { name: "Replace “wide”?" });
    await expect(replace).toBeVisible();
    await replace.getByRole("button", { name: "Cancel" }).click();
    await expect(again).toBeVisible(); // back to the name
    await again.getByRole("button", { name: "Save look" }).click();
    await page
      .getByRole("dialog", { name: "Replace “wide”?" })
      .getByRole("button", { name: "Replace" })
      .click();
    await expect(page.getByTestId("toasts")).toContainText("Saved as “wide”");
    const stored = await page.evaluate(() => window.localStorage.getItem("lumengrab.mock.looks"));
    expect((JSON.parse(stored ?? "{}") as { looks: unknown[] }).looks).toHaveLength(1);
  });

  test("the menu of a look: rename, update, delete with Undo", async ({ page }) => {
    await open(page);
    await toPresentation(page);
    await page.getByRole("button", { name: "Save as my look" }).first().click();
    await page.getByRole("dialog").getByLabel("Name").fill("Docs");
    await page.getByRole("dialog").getByRole("button", { name: "Save look" }).click();
    const looks = async () =>
      JSON.parse(
        (await page.evaluate(() => window.localStorage.getItem("lumengrab.mock.looks"))) ?? "{}",
      ) as {
        looks: { name: string; parts: { cornerRadius?: number } }[];
      };

    await page.getByRole("button", { name: "More actions for Docs" }).click({ force: true });
    await page.getByRole("menuitem", { name: "Rename" }).click();
    const rename = page.getByTestId("look-rename");
    await rename.fill("Handbook");
    await rename.press("Enter");
    expect((await looks()).looks[0]?.name).toBe("Handbook");

    await page.getByRole("slider", { name: "Corner radius" }).fill("44");
    await page.getByRole("button", { name: "More actions for Handbook" }).click({ force: true });
    await page.getByRole("menuitem", { name: "Update with current settings" }).click();
    // A look keeps lengths for a picture 1280 px wide; this one is wider, so 44 px is stored smaller.
    const width = await page.evaluate(
      () => window.__lumengrabEditor?.ui.getState().imageSize.width ?? 0,
    );
    await expect
      .poll(async () => (await looks()).looks[0]?.parts.cornerRadius)
      .toBe(Math.round(44 / (width / 1280)));

    await page.getByRole("button", { name: "More actions for Handbook" }).click({ force: true });
    await page.getByRole("menuitem", { name: "Delete" }).click();
    const confirm = page.getByRole("dialog", { name: "Delete “Handbook”?" });
    await confirm.getByRole("button", { name: "Delete" }).click();
    await expect(page.getByRole("button", { name: "Handbook", exact: true })).toHaveCount(0);
    await page.getByTestId("toasts").getByRole("button", { name: "Undo" }).click();
    await expect(page.getByRole("button", { name: "Handbook", exact: true })).toBeVisible();
    // Built-in looks have no rename or delete.
    await page.getByRole("button", { name: "More actions for Citrus" }).click({ force: true });
    await expect(page.getByRole("menuitem", { name: "Delete" })).toHaveCount(0);
    await expect(page.getByRole("menuitem", { name: "Use as default" })).toBeVisible();
  });

  test("the default look: star, toast, badge, and a new picture starts with it", async ({
    page,
  }) => {
    await open(page);
    await toPresentation(page);
    await page.getByRole("button", { name: "Ocean", exact: true }).click();
    await page.getByRole("button", { name: "Use “Ocean” as default" }).click();
    await expect(page.getByTestId("toasts")).toContainText("Ocean is now your default look");
    await expect(page.getByRole("img", { name: "Default look" })).toHaveCount(1);
    await expect(page.getByText("Ocean is your default look")).toBeVisible();
    await page.getByRole("button", { name: "Paper", exact: true }).hover();
    await page.getByRole("button", { name: "Use Paper as default" }).click();
    await expect(page.getByTestId("toasts")).toContainText("Paper is now your default look");

    // A document whose presentation is off gets the default look when its tab is opened.
    await page.reload();
    await expect(page.getByTestId("editor-canvas")).toBeVisible();
    await page.getByRole("radio", { name: "Presentation" }).click();
    await expect(page.getByTestId("presentation-panel")).toBeVisible();
    const p = await presentation(page);
    expect((p.background as { stops: { color: string }[] }).stops[0]?.color).toBe("#F4F4F5");
  });

  test("a look with a background picture keeps it, and says so when the picture is gone", async ({
    page,
  }) => {
    await open(page);
    await toPresentation(page);
    await page.getByRole("radio", { name: "Image", exact: true }).click();
    await page.getByTestId("image-drop").click();
    await expect(page.getByAltText("Background picture")).toBeVisible();
    await page.getByRole("button", { name: "Save as my look" }).first().click();
    await page.getByRole("dialog").getByLabel("Name").fill("Photo");
    await page.getByRole("dialog").getByRole("button", { name: "Save look" }).click();
    await expect(page.getByTestId("toasts")).toContainText("Saved as “Photo”");
    // Same page: choose another look, then the photo look again: the picture comes back.
    await page.getByRole("button", { name: "Citrus", exact: true }).click();
    await page.getByRole("button", { name: "Photo", exact: true }).click();
    expect((await presentation(page)).background.type).toBe("image");

    // After a reload the mock has forgotten the picture (the real app keeps it as a file).
    await page.reload();
    await expect(page.getByTestId("editor-canvas")).toBeVisible();
    await toPresentation(page);
    await page.getByRole("button", { name: "Photo", exact: true }).click();
    const notice = page.getByRole("alert").filter({ hasText: "Could not apply your look" });
    await expect(notice).toContainText("“Photo” uses a picture that can't be found.");
    await page.screenshot({
      path: "test-results/presentation-look-notice.png",
      animations: "disabled",
    });
    await notice.getByRole("button", { name: "Remove image from look" }).click();
    await expect(notice).toHaveCount(0);
    const stored = await page.evaluate(() => window.localStorage.getItem("lumengrab.mock.looks"));
    const photo = (
      JSON.parse(stored ?? "{}") as { looks: { name: string; parts: Record<string, unknown> }[] }
    ).looks.find((l) => l.name === "Photo");
    expect(photo?.parts["background"]).toBeUndefined();
  });
});
