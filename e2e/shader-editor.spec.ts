import { expect, test, type Page } from "@playwright/test";
import type { Presentation } from "../src/document/schema";

// The preview plays by itself; with Reduce Motion it starts paused (software WebGL is slow, and these tests are not about playing).
test.use({ viewport: { width: 1440, height: 900 }, reducedMotion: "reduce" });

const openStudio = async (page: Page, scenario = "stack") => {
  await page.goto(`/?window=document&label=doc-1&scenario=${scenario}`);
  await expect(page.getByTestId("editor-canvas")).toBeVisible();
  await page.waitForFunction(() => window.__lumengrabEditor?.ui.getState().view != null);
  await page.getByRole("radio", { name: "Presentation" }).click();
  await page.getByRole("radio", { name: "Animated", exact: true }).click();
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

const newShader = async (
  page: Page,
  studio: ReturnType<Page["getByRole"]>,
  start: "An example" | "A blank file" = "An example",
) => {
  await studio.getByRole("button", { name: "Add", exact: true }).click();
  await page.getByRole("menuitem", { name: "Write new shader…" }).click();
  const dialog = page.getByRole("dialog", { name: "New shader" });
  await expect(dialog).toBeVisible();
  await dialog.getByRole("radio", { name: start }).click();
  await dialog.getByRole("button", { name: "Open shader editor" }).click();
  await expect(editor(page)).toBeVisible();
};

test.describe("shader editor (browser mock)", () => {
  test("a new shader from an example compiles, lists its settings and is added as a layer", async ({
    page,
  }) => {
    const studio = await openStudio(page);
    await newShader(page, studio);
    await expect(editor(page).getByRole("status", { name: "Compile status" })).toHaveText(
      "Compiled",
    );
    await expect(editor(page).getByText(/3 parameters found: speed, scale, soft/)).toBeVisible();
    const params = editor(page).getByRole("region", { name: "Parameters" });
    for (const name of ["speed", "scale", "soft"])
      await expect(params.getByText(name, { exact: true })).toBeVisible();
    await expect(editor(page).getByText("GLSL ES 1.00 · WebGL 1")).toBeVisible();
    await page.screenshot({ path: "test-results/shader-editor.png" });
    await editor(page).getByRole("textbox", { name: "Shader name" }).fill("Glow");
    await editor(page).getByRole("button", { name: "Apply" }).click();
    await expect(editor(page)).toHaveCount(0);
    const list = await layers(page);
    expect(list).toHaveLength(5);
    // The document is untouched until the Studio's own Apply; the Studio shows the new layer on top.
    await expect(
      studio.getByRole("list", { name: "Layers" }).getByRole("listitem").first(),
    ).toHaveAttribute("aria-label", "Glow");
    await expect(studio.getByText("Custom shader · Generator")).toBeVisible();
    await studio.getByRole("button", { name: "Apply" }).click();
    const applied = (await layers(page)).at(-1);
    expect(applied).toMatchObject({ kind: "custom", name: "Glow", role: "generator" });
    expect(applied?.code).toContain("void main()");
  });

  test("a mistake names its line, keeps the last working version and blocks Apply", async ({
    page,
  }) => {
    const studio = await openStudio(page);
    await newShader(page, studio);
    const text = await code(page).inputValue();
    await code(page).fill(text.replace("sin(p.x", "sinn(p.x"));
    await expect(editor(page).getByRole("status", { name: "Compile status" })).toHaveText("Error");
    await expect(editor(page).getByText(/Line 16:.*sinn/)).toBeVisible();
    await expect(
      editor(page).getByText("The preview keeps showing the last working version."),
    ).toBeVisible();
    await expect(editor(page).getByRole("button", { name: "Apply" })).toBeDisabled();
    await code(page).fill(text);
    await expect(editor(page).getByRole("status", { name: "Compile status" })).toHaveText(
      "Compiled",
    );
    await expect(editor(page).getByRole("button", { name: "Apply" })).toBeEnabled();
  });

  test("code over the limit is too long, and says so", async ({ page }) => {
    const studio = await openStudio(page);
    await newShader(page, studio, "A blank file");
    await code(page).fill(`// ${"x".repeat(17000)}\nvoid main() { gl_FragColor = vec4(1.0); }`);
    await expect(editor(page).getByRole("status", { name: "Compile status" })).toHaveText(
      "Too long",
    );
    await expect(editor(page).getByText("The code is too long to compile")).toBeVisible();
    await expect(editor(page).getByTestId("code-size")).toHaveText("Too long");
    await expect(editor(page).getByRole("button", { name: "Apply" })).toBeDisabled();
  });

  test("an example that is an effect switches the shader to Effect and the preview to Result and Input", async ({
    page,
  }) => {
    const studio = await openStudio(page);
    await newShader(page, studio, "A blank file");
    await editor(page).getByRole("button", { name: "Examples" }).click();
    await page.getByRole("menuitem", { name: /Light sweep/ }).click();
    await expect(editor(page).getByRole("radio", { name: "Effect" })).toBeChecked();
    await expect(editor(page).getByRole("radio", { name: "Result" })).toBeVisible();
    await editor(page).getByRole("radio", { name: "Input" }).click();
    await expect(editor(page).getByText("the layers below, as a picture")).toBeVisible();
    await expect(editor(page).getByRole("status", { name: "Compile status" })).toHaveText(
      "Compiled",
    );
  });

  test("the Settings tab shows the settings of the code and writes changes back into it", async ({
    page,
  }) => {
    const studio = await openStudio(page);
    await newShader(page, studio);
    await editor(page).getByRole("tab", { name: "Settings" }).click();
    const list = editor(page).getByRole("list", { name: "Settings" });
    await expect(list.getByRole("listitem")).toHaveCount(3);
    // The first setting is open already.
    await expect(list.getByRole("button", { name: "speed setting" })).toHaveAttribute(
      "aria-expanded",
      "true",
    );
    const label = editor(page).getByRole("textbox", { name: "Label", exact: true });
    await label.fill("Pace");
    await label.press("Enter");
    await editor(page).getByRole("tab", { name: "fragment.glsl" }).click();
    await expect(code(page)).toHaveValue(
      /\/\/ @param float speed = 1\.00 \[0, 4\] step [0-9.]+ "Pace"|"Pace"/,
    );
    await editor(page).getByRole("tab", { name: "Settings" }).click();
    await editor(page).getByRole("button", { name: "Add setting" }).click();
    await expect(list.getByRole("listitem")).toHaveCount(4);
    await editor(page).getByRole("button", { name: "Remove setting" }).click();
    await expect(list.getByRole("listitem")).toHaveCount(3);
    await editor(page).getByRole("tab", { name: "fragment.glsl" }).click();
    await expect(code(page)).not.toHaveValue(/setting;/);
  });

  test("the Reference tab filters its list and inserts a uniform into the code", async ({
    page,
  }) => {
    const studio = await openStudio(page);
    await newShader(page, studio, "A blank file");
    await editor(page).getByRole("tab", { name: "Reference" }).click();
    await expect(editor(page).getByText("noise(vec2)")).toBeVisible();
    await editor(page).getByRole("textbox", { name: "Search inputs and helpers" }).fill("palette");
    await expect(editor(page).getByText("noise(vec2)")).toHaveCount(0);
    await expect(editor(page).getByText("u_palette[8]")).toBeVisible();
    await editor(page).getByRole("textbox", { name: "Search inputs and helpers" }).fill("");
    await editor(page).getByRole("button", { name: "Insert u_seed" }).click();
    await expect(code(page)).toHaveValue(/uniform float u_seed;/);
  });

  test("Copy for AI shows the brief with or without the current code", async ({ page }) => {
    const studio = await openStudio(page);
    await newShader(page, studio);
    await editor(page).getByRole("button", { name: "Copy for AI" }).click();
    const panel = page.getByRole("dialog", { name: "Ask an AI to write your shader" });
    await expect(
      panel.getByText("LumenGrab has no built-in AI and sends nothing anywhere.", { exact: false }),
    ).toBeVisible();
    const brief = panel.getByTestId("ai-brief");
    await expect(brief).toContainText("WebGL 1, GLSL ES 1.00");
    await expect(brief).toContainText("MY CURRENT CODE");
    await panel.getByRole("switch", { name: "Include my current code" }).click();
    await expect(brief).not.toContainText("MY CURRENT CODE");
    await panel.getByRole("button", { name: "Close" }).click();
    await expect(panel).toHaveCount(0);
  });

  test("a shader is kept in My shaders and comes back from the Add menu", async ({ page }) => {
    const studio = await openStudio(page);
    await newShader(page, studio);
    await editor(page).getByRole("textbox", { name: "Shader name" }).fill("Glow");
    await editor(page).getByRole("button", { name: "Apply" }).click();
    await studio.getByRole("button", { name: "Save to My shaders" }).click();
    const dialog = page.getByRole("dialog", { name: "Save to My shaders" });
    await expect(dialog.getByText(/speed 1\.0/i)).toBeVisible();
    await dialog.getByRole("button", { name: "Save shader" }).click();
    await expect(page.getByText("Saved “Glow” to My shaders")).toBeVisible();
    await studio.getByRole("button", { name: "Add", exact: true }).click();
    await page.getByRole("menuitem", { name: "Glow Generator" }).click();
    await expect(
      studio.getByRole("list", { name: "Layers" }).getByRole("listitem").first(),
    ).toHaveAttribute("aria-label", "Glow");
    expect(
      (await page.evaluate(() =>
        window.localStorage.getItem("lumengrab.mock.shaders.my-shaders"),
      )) ?? "",
    ).toContain('"Glow"');
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
    await expect(editor(page).getByRole("status", { name: "Compile status" })).toHaveText(
      "Not run",
    );
    await expect(code(page)).not.toBeEditable();
    await expect(editor(page).getByText("Custom code is off")).toBeVisible();
    await expect(editor(page).getByRole("button", { name: "Apply" })).toBeDisabled();
    await editor(page).getByRole("button", { name: "Run custom code" }).click();
    await expect(editor(page).getByRole("status", { name: "Compile status" })).toHaveText(
      "Compiled",
    );
    await expect(code(page)).toBeEditable();
    const stored = await page.evaluate(() =>
      window.localStorage.getItem("lumengrab.mock.shaders.trusted"),
    );
    expect(stored ?? "").toContain("documents");
    await editor(page).getByRole("button", { name: "Cancel" }).click();
    await expect(studio.getByText("This file contains custom shader code")).toHaveCount(0);
  });

  test("Cancel with changes asks first", async ({ page }) => {
    const studio = await openStudio(page);
    await newShader(page, studio);
    await editor(page).getByRole("button", { name: "Cancel" }).click();
    await expect(editor(page)).toHaveCount(0); // nothing changed since the example was chosen
    await newShader(page, studio);
    await code(page).fill("// changed\n");
    await editor(page).getByRole("button", { name: "Cancel" }).click();
    const dialog = page.getByRole("dialog", { name: "Discard changes?" });
    await expect(dialog).toBeVisible();
    await dialog.getByRole("button", { name: "Keep editing" }).click();
    await expect(editor(page)).toBeVisible();
  });
});
