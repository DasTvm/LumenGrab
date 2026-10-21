import { expect, test, type Page } from "@playwright/test";
import type { Presentation } from "../src/document/schema";

// The preview plays by itself; with Reduce Motion it starts paused (software WebGL is slow, and these tests are not about playing).
test.use({ viewport: { width: 1440, height: 900 }, reducedMotion: "reduce" });

const openAnimated = async (page: Page, scenario = "stack") => {
  await page.goto(`/?window=document&label=doc-1&scenario=${scenario}`);
  await expect(page.getByTestId("editor-canvas")).toBeVisible();
  await page.waitForFunction(() => window.__lumengrabEditor?.ui.getState().view != null);
  await page.getByRole("radio", { name: "Presentation" }).click();
  await page.getByRole("radio", { name: "Animated", exact: true }).click();
};
const openStudio = async (page: Page, scenario = "stack") => {
  await openAnimated(page, scenario);
  await page.getByRole("button", { name: "Open Background Studio" }).click();
  const studio = page.getByRole("dialog", { name: "Background Studio" });
  await expect(studio).toBeVisible();
  return studio;
};
const doc = (page: Page) =>
  page.evaluate(
    () => window.__lumengrabEditor?.editor.getState().project.presentation,
  ) as Promise<Presentation>;
type Layer = {
  id: string;
  kind: string;
  name?: string;
  role?: string;
  code?: string;
  params: Record<string, unknown>;
  enabled: boolean;
};
const layers = async (page: Page) =>
  ((await doc(page)).background as unknown as { layers: Layer[] }).layers;
const editor = (page: Page) => page.getByRole("dialog", { name: "Shader editor" });
const code = (page: Page) => editor(page).getByRole("textbox", { name: "Shader code" });
const chip = (page: Page) => editor(page).getByRole("status", { name: "Compile status" });
const region = (page: Page) => page.getByRole("region", { name: "Background" });
const stored = (page: Page) =>
  page.evaluate(() => window.localStorage.getItem("lumengrab.mock.shaders.my-shaders") ?? "");

/** "Write new shader…" in the Studio: no dialog, the editor opens on a layer that already runs an example. */
const writeInStudio = async (page: Page, studio: ReturnType<Page["getByRole"]>) => {
  await studio.getByRole("button", { name: "Add", exact: true }).click();
  await page.getByRole("menuitem", { name: "Write new shader…" }).click();
  await expect(editor(page)).toBeVisible();
};

test.describe("shader editor (browser mock)", () => {
  test("New shader in the Animated tab opens the editor on a working example, with nothing to fill in first", async ({
    page,
  }) => {
    await openAnimated(page);
    await expect(region(page).getByText("Your shaders")).toBeVisible();
    await expect(
      region(page).getByText(/Write your own background with a little code/),
    ).toBeVisible();
    await region(page).getByRole("button", { name: "New shader" }).click();
    await expect(editor(page)).toBeVisible();
    // The Studio is not in the way: the editor is the whole window, and its only way out is Done.
    await expect(editor(page).getByRole("button", { name: "Done" })).toBeVisible();
    await expect(editor(page).getByRole("button", { name: "Apply" })).toHaveCount(0);
    await expect(editor(page).getByRole("button", { name: "Cancel" })).toHaveCount(0);
    await expect(chip(page)).toHaveText(/works/i);
    await expect(editor(page).getByText(/3 settings found/)).toBeVisible();
    const settings = editor(page).getByRole("region", { name: "Settings" });
    for (const name of ["speed", "scale", "soft"])
      await expect(settings.getByText(name, { exact: true })).toBeVisible();
    await expect(chip(page)).toHaveText("Saved · works");
    await page.screenshot({ path: "test-results/shader-editor.png" });
  });

  test("it saves by itself, Done makes it the background, and it is one of Your shaders", async ({
    page,
  }) => {
    await openAnimated(page);
    await region(page).getByRole("button", { name: "New shader" }).click();
    await editor(page).getByRole("textbox", { name: "Shader name" }).fill("Glow");
    await expect.poll(() => stored(page)).toContain('"Glow"');
    await editor(page).getByRole("button", { name: "Done" }).click();
    await expect(editor(page)).toHaveCount(0);
    await expect(page.getByRole("dialog", { name: "Background Studio" })).toHaveCount(0);
    const list = await layers(page);
    expect(list).toHaveLength(1);
    expect(list[0]).toMatchObject({ kind: "custom", name: "Glow", role: "generator" });
    expect(list[0]?.code).toContain("void main()");
    await expect(region(page).getByRole("button", { name: "Glow", exact: true })).toHaveAttribute(
      "aria-pressed",
      "true",
    );
    // One undo step puts the old background back.
    await page.keyboard.press("ControlOrMeta+z");
    expect(
      ((await doc(page)).background as unknown as { layers: Layer[] }).layers[0]?.kind,
    ).not.toBe("custom");
  });

  test("a tile of Your shaders is applied with one click and has Edit, Duplicate, Rename and Delete", async ({
    page,
  }) => {
    await openAnimated(page);
    await region(page).getByRole("button", { name: "New shader" }).click();
    await editor(page).getByRole("textbox", { name: "Shader name" }).fill("Glow");
    await expect.poll(() => stored(page)).toContain('"Glow"');
    await editor(page).getByRole("button", { name: "Done" }).click();

    // Another look, then the shader again with one click.
    await region(page).getByRole("button", { name: "Silk", exact: true }).click();
    expect((await layers(page))[0]?.kind).toBe("liquid");
    await region(page).getByRole("button", { name: "Glow", exact: true }).click();
    expect((await layers(page))[0]).toMatchObject({ kind: "custom", name: "Glow" });

    await region(page).getByRole("button", { name: "More for Glow" }).click();
    await page.getByRole("menuitem", { name: "Duplicate" }).click();
    await expect(
      region(page).getByRole("button", { name: "Glow copy", exact: true }),
    ).toBeVisible();

    await region(page).getByRole("button", { name: "More for Glow copy" }).click();
    await page.getByRole("menuitem", { name: "Rename" }).click();
    const dialog = page.getByRole("dialog", { name: "Rename shader" });
    await dialog.getByRole("textbox", { name: "Name" }).fill("Wobble");
    await dialog.getByRole("button", { name: "Rename" }).click();
    await expect(region(page).getByRole("button", { name: "Wobble", exact: true })).toBeVisible();
    await expect(region(page).getByRole("button", { name: "Glow copy", exact: true })).toHaveCount(
      0,
    );

    await region(page).getByRole("button", { name: "More for Wobble" }).click();
    await page.getByRole("menuitem", { name: "Delete" }).click();
    await expect(region(page).getByRole("button", { name: "Wobble", exact: true })).toHaveCount(0);
    await expect(page.getByText("Deleted “Wobble”")).toBeVisible();
    await page.getByRole("button", { name: "Undo" }).last().click();
    await expect(region(page).getByRole("button", { name: "Wobble", exact: true })).toBeVisible();

    // Edit opens the editor on it again.
    await region(page).getByRole("button", { name: "More for Glow", exact: true }).click();
    await page.getByRole("menuitem", { name: "Edit shader" }).click();
    await expect(editor(page)).toBeVisible();
    await expect(editor(page).getByRole("textbox", { name: "Shader name" })).toHaveValue("Glow");
    await page.keyboard.press("Escape");
    await expect(editor(page)).toHaveCount(0);
  });

  test("in the Studio, Write new shader adds a layer at once and Done returns to the Studio", async ({
    page,
  }) => {
    const studio = await openStudio(page);
    await writeInStudio(page, studio);
    await expect(chip(page)).toHaveText("Saved · works");
    await editor(page).getByRole("textbox", { name: "Shader name" }).fill("Glow");
    await editor(page).getByRole("button", { name: "Done" }).click();
    await expect(editor(page)).toHaveCount(0);
    await expect(
      studio.getByRole("list", { name: "Layers" }).getByRole("listitem").first(),
    ).toHaveAttribute("aria-label", "Glow");
    await expect(studio.getByText("Custom shader · Generator")).toBeVisible();
    // The document is untouched until the Studio's own Apply.
    expect(await layers(page)).toHaveLength(5);
    await studio.getByRole("button", { name: "Apply" }).click();
    expect((await layers(page)).at(-1)).toMatchObject({
      kind: "custom",
      name: "Glow",
      role: "generator",
    });
    // And it is kept for later: it comes back from the Add menu of a new Studio.
    await page.getByRole("button", { name: "Open Background Studio" }).click();
    const again = page.getByRole("dialog", { name: "Background Studio" });
    await again.getByRole("button", { name: "Add", exact: true }).click();
    await expect(page.getByRole("menuitem", { name: "Glow Generator" })).toBeVisible();
  });

  test("a mistake names its line, the preview keeps the last version and the shader stays saved", async ({
    page,
  }) => {
    const studio = await openStudio(page);
    await writeInStudio(page, studio);
    await expect(chip(page)).toHaveText("Saved · works");
    const text = await code(page).inputValue();
    await code(page).fill(text.replace("sin(p.x", "sinn(p.x"));
    await expect(chip(page)).toHaveText("Saved · has a mistake");
    await expect(editor(page).getByText(/Line 16:.*sinn/)).toBeVisible();
    await expect(
      editor(page).getByText("The preview keeps showing the last version that worked."),
    ).toBeVisible();
    await code(page).fill(text);
    await expect(chip(page)).toHaveText("Saved · works");
  });

  test("code over the limit is too long, and says so", async ({ page }) => {
    const studio = await openStudio(page);
    await writeInStudio(page, studio);
    await code(page).fill(`// ${"x".repeat(17000)}\nvoid main() { gl_FragColor = vec4(1.0); }`);
    await expect(chip(page)).toHaveText("Too long");
    await expect(editor(page).getByText("The code is too long to compile")).toBeVisible();
  });

  test("whether it draws or changes the picture is read from the code, with no switch", async ({
    page,
  }) => {
    const studio = await openStudio(page);
    await writeInStudio(page, studio);
    await expect(editor(page).getByRole("radio", { name: "Effect" })).toHaveCount(0);
    await expect(editor(page).getByText(/draws the background/)).toBeVisible();
    await editor(page).getByRole("button", { name: "Examples" }).click();
    await page.getByRole("menuitem", { name: /Light sweep/ }).click();
    // Software WebGL in CI draws the effect over the layers below slowly: the check of the code waits for it.
    await expect(editor(page).getByText(/changes the picture below/)).toBeVisible({
      timeout: 20_000,
    });
    await editor(page).getByRole("button", { name: "Done" }).click();
    await expect(studio.getByText("Custom shader · Effect")).toBeVisible();
  });

  test("Add a setting writes the @param line and shows the control", async ({ page }) => {
    const studio = await openStudio(page);
    await writeInStudio(page, studio);
    const settings = editor(page).getByRole("region", { name: "Settings" });
    await expect(settings.getByText("speed", { exact: true })).toBeVisible();
    await editor(page).getByRole("button", { name: "Add a setting" }).click();
    await expect(code(page)).toHaveValue(/\/\/ @param float setting = /);
    await expect(code(page)).toHaveValue(/uniform float setting;/);
    await expect(settings.getByText("setting", { exact: true })).toBeVisible();
  });

  test("a colour setting opens a picker that is wide enough, stays inside the panel, and changes the shader", async ({
    page,
  }) => {
    await openAnimated(page);
    await region(page).getByRole("button", { name: "New shader" }).click();
    await editor(page).getByRole("button", { name: "Examples" }).click();
    await page.getByRole("menuitem", { name: /Starfield/ }).click();
    const settings = editor(page).getByRole("region", { name: "Settings" });
    await settings.getByRole("button", { name: "Star", exact: true }).click();
    const picker = page.getByTestId("color-picker");
    await expect(picker).toBeVisible();
    const box = await picker.boundingBox();
    const panel = await editor(page)
      .getByRole("complementary", { name: "Preview and settings" })
      .boundingBox();
    expect(box?.width ?? 0).toBeGreaterThan(240);
    expect((box?.x ?? 0) + (box?.width ?? 0)).toBeLessThanOrEqual(
      (panel?.x ?? 0) + (panel?.width ?? 0),
    );
    expect(box?.x ?? 0).toBeGreaterThanOrEqual(panel?.x ?? 0);
    const hex = picker.getByRole("textbox", { name: "Hex colour" });
    await hex.fill("#FF8800");
    await hex.press("Enter");
    // The first Escape closes the picker, not the editor.
    await page.keyboard.press("Escape");
    await expect(picker).toHaveCount(0);
    await expect(editor(page)).toBeVisible();
    await editor(page).getByRole("button", { name: "Done" }).click();
    expect((await layers(page))[0]?.params["star"]).toBe("#FF8800");
  });

  test("a shader of yours shows its own colours and sliders under Customise, and they change it", async ({
    page,
  }) => {
    await openAnimated(page);
    await region(page).getByRole("button", { name: "New shader" }).click();
    await editor(page).getByRole("button", { name: "Examples" }).click();
    await page.getByRole("menuitem", { name: /Starfield/ }).click();
    await editor(page).getByRole("button", { name: "Done" }).click();
    const customise = region(page).getByRole("group", { name: "Customise" });
    // The starfield has its own star colour and uses the first palette colour: both are there.
    await expect(customise.getByRole("button", { name: "Star", exact: true })).toBeVisible();
    await customise.getByRole("button", { name: "Star", exact: true }).click();
    const hex = page.getByTestId("color-picker").getByRole("textbox", { name: "Hex colour" });
    await hex.fill("#33CC99");
    await hex.press("Enter");
    await expect.poll(async () => (await layers(page))[0]?.params["star"]).toBe("#33CC99");
    await page.keyboard.press("Escape");
    // A slider of the code.
    const twinkle = customise.getByRole("slider", { name: "Twinkle" });
    await twinkle.focus();
    await page.keyboard.press("End");
    expect((await layers(page))[0]?.params["twinkle"]).toBe(1);
  });

  test("Help holds the inputs, the helpers and the prompt for an AI", async ({ page, context }) => {
    await context.grantPermissions(["clipboard-read", "clipboard-write"]);
    const studio = await openStudio(page);
    await writeInStudio(page, studio);
    await editor(page).getByRole("button", { name: "Help" }).click();
    const help = editor(page).getByRole("dialog", { name: "Help for shaders" });
    await expect(help.getByText("u_palette[8]")).toBeVisible();
    await expect(help.getByText("noise(vec2)")).toBeVisible();
    await expect(help.getByText("// @param float a = 1.0 [0, 4]")).toBeVisible();
    await help.getByRole("button", { name: "Copy prompt for an AI" }).click();
    await expect(page.getByText("Prompt copied. Paste it into your AI.")).toBeVisible();
    const clip = await page.evaluate(() => navigator.clipboard.readText());
    expect(clip).toContain("WebGL 1, GLSL ES 1.00");
    expect(clip).toContain("MY CURRENT CODE");
    await page.keyboard.press("Escape");
    await expect(help).toHaveCount(0);
    // The first Escape closed the help only; the editor is still there.
    await expect(editor(page)).toBeVisible();
  });

  test("a file from outside with shader code does not run it until the user allows it", async ({
    page,
  }) => {
    const studio = await openStudio(page, "shader-code");
    const rows = studio.getByRole("list", { name: "Layers" }).getByRole("listitem");
    await rows.first().getByRole("button", { name: "Glow", exact: true }).click();
    await expect(studio.getByText("This file contains custom shader code").first()).toBeVisible();
    await studio.getByRole("tab", { name: "Code" }).click();
    await expect(studio.getByText("Not run")).toBeVisible();
    // The editor opens read-only.
    await studio.getByRole("button", { name: "Open editor" }).click();
    await expect(chip(page)).toHaveText("Not run");
    await expect(code(page)).not.toBeEditable();
    await expect(editor(page).getByText("Custom code is off")).toBeVisible();
    await editor(page).getByRole("button", { name: "Run custom code" }).click();
    await expect(chip(page)).toHaveText(/works/i);
    await expect(code(page)).toBeEditable();
    const trusted = await page.evaluate(() =>
      window.localStorage.getItem("lumengrab.mock.shaders.trusted"),
    );
    expect(trusted ?? "").toContain("documents");
    await editor(page).getByRole("button", { name: "Done" }).click();
    await expect(studio.getByText("This file contains custom shader code")).toHaveCount(0);
    // Opening it and leaving without a change does not put it in Your shaders.
    expect(await stored(page)).not.toContain('"Glow"');
  });
});
