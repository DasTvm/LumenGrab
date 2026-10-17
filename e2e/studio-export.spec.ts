import { expect, test, type Page } from "@playwright/test";

test.use({ viewport: { width: 1440, height: 900 } });

const openExport = async (page: Page, loop?: string) => {
  await page.goto("/?window=document&label=doc-1&scenario=stack");
  await expect(page.getByTestId("editor-canvas")).toBeVisible();
  await page.waitForFunction(() => window.__lumengrabEditor?.ui.getState().view != null);
  await page.getByRole("radio", { name: "Presentation" }).click();
  await page.getByRole("radio", { name: "Animated", exact: true }).click();
  await page.getByRole("button", { name: "Open Background Studio" }).click();
  const studio = page.getByRole("dialog", { name: "Background Studio" });
  await studio.getByRole("button", { name: "Pause" }).click();
  if (loop) {
    const field = studio.getByRole("textbox", { name: "Loop length" });
    await field.fill(loop);
    await field.press("Enter");
  }
  await studio.getByRole("button", { name: "Export" }).click();
  const dialog = page.getByRole("dialog", { name: "Export" });
  await expect(dialog).toBeVisible();
  return dialog;
};
const written = (page: Page) =>
  page.evaluate(() => Array.from(window.__lumengrabMock?.written?.["t1"]?.slice(0, 8) ?? []));

test.describe("Studio export (browser mock)", () => {
  test("opens with the defaults of the design: 1080p, 30 frames a second, one loop, high quality", async ({
    page,
  }) => {
    const dialog = await openExport(page);
    await expect(
      dialog.getByText("Render your animated background as a short loop."),
    ).toBeVisible();
    await expect(dialog.getByRole("radio", { name: "Whole composition" })).toBeChecked();
    await expect(dialog.getByRole("radio", { name: "1080p" })).toBeChecked();
    await expect(dialog.getByRole("radio", { name: "30" })).toBeChecked();
    await expect(dialog.getByRole("radio", { name: "1", exact: true })).toBeChecked();
    await expect(dialog.getByText("1 × 8 s")).toBeVisible();
    await expect(dialog.getByTestId("export-estimate")).toContainText("8 s · 240 frames");
    await page.screenshot({ path: "test-results/studio-export.png" });
  });

  test("a picture is written as a PNG, and the dialog says it is finished", async ({ page }) => {
    const dialog = await openExport(page);
    await dialog.getByRole("radio", { name: "Picture" }).click();
    await expect(
      dialog.getByText("Save a still picture of the background or the whole composition."),
    ).toBeVisible();
    await expect(dialog.getByText("Still frame")).toBeVisible();
    await dialog.getByRole("button", { name: "Export", exact: true }).click();
    await expect(dialog.getByText("Export finished")).toBeVisible();
    await expect(dialog.getByText(/\.png$/)).toBeVisible();
    expect(await written(page)).toEqual([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
    await dialog.getByRole("button", { name: "Show in folder" }).click();
    await dialog.getByRole("button", { name: "Done" }).click();
    await expect(dialog).toHaveCount(0);
  });

  test("a GIF is made frame by frame, loops, and is written as a GIF", async ({ page }) => {
    const dialog = await openExport(page, "1");
    await dialog.getByRole("radio", { name: "GIF" }).click();
    await dialog.getByRole("radio", { name: "720p" }).click();
    await dialog.getByRole("radio", { name: "64" }).click();
    await expect(dialog.getByTestId("export-estimate")).toContainText("1 s · 30 frames");
    await dialog.getByRole("radio", { name: "24" }).click();
    await expect(dialog.getByTestId("export-estimate")).toContainText("24 frames");
    await dialog.getByRole("button", { name: "Export", exact: true }).click();
    await expect(dialog.getByText("Export finished")).toBeVisible({ timeout: 60_000 });
    const head = await written(page);
    expect(String.fromCharCode(...head.slice(0, 6))).toBe("GIF89a");
  });

  test("a WebM video is written with the right header", async ({ page }) => {
    const dialog = await openExport(page, "1");
    await dialog.getByRole("radio", { name: "WebM" }).click();
    await dialog.getByRole("radio", { name: "720p" }).click();
    await dialog.getByRole("radio", { name: "24" }).click();
    await dialog.getByRole("button", { name: "Export", exact: true }).click();
    await expect(dialog.getByText("Export finished")).toBeVisible({ timeout: 90_000 });
    expect((await written(page)).slice(0, 4)).toEqual([0x1a, 0x45, 0xdf, 0xa3]);
  });

  test("a computer that cannot encode video says so and offers GIF", async ({ page }) => {
    await page.addInitScript(() => {
      Reflect.deleteProperty(window, "VideoEncoder");
    });
    const dialog = await openExport(page);
    await expect(dialog.getByText("This computer cannot create MP4.")).toBeVisible();
    await expect(dialog.getByRole("button", { name: "Export", exact: true })).toBeDisabled();
    await dialog.getByRole("button", { name: "Switch to GIF" }).click();
    await expect(dialog.getByRole("radio", { name: "GIF" })).toBeChecked();
    await expect(dialog.getByText("This computer cannot create MP4.")).toHaveCount(0);
  });

  test("a length the limits do not allow is shortened, with a warning and its own button", async ({
    page,
  }) => {
    const dialog = await openExport(page);
    await dialog.getByRole("radio", { name: "4K" }).click();
    await dialog.getByRole("radio", { name: "60" }).click();
    await dialog.getByRole("radio", { name: "5", exact: true }).click();
    await expect(dialog.getByText("Length is limited at this size and frame rate")).toBeVisible();
    await expect(dialog.getByRole("button", { name: "Export shortened version" })).toBeVisible();
    await expect(dialog.getByTestId("export-estimate")).toContainText("shortened");
    await dialog.getByRole("radio", { name: "1080p" }).click();
    await expect(dialog.getByText("Length is limited at this size and frame rate")).toHaveCount(0);
  });

  test("Cancel while rendering stops the export and brings the form back", async ({ page }) => {
    const dialog = await openExport(page);
    await dialog.getByRole("radio", { name: "GIF" }).click();
    await dialog.getByRole("radio", { name: "720p" }).click();
    await dialog.getByRole("button", { name: "Export", exact: true }).click();
    await expect(dialog.getByText(/Frame \d+ of 240/)).toBeVisible();
    await expect(dialog.getByText(/You can keep working in the Studio/)).toBeVisible();
    await dialog.getByRole("button", { name: "Cancel" }).click();
    await expect(dialog.getByRole("radio", { name: "GIF" })).toBeVisible();
    await expect(dialog.getByText("Export finished")).toHaveCount(0);
  });

  test("a failed write says so", async ({ page }) => {
    await page.goto("/?window=document&label=doc-1&scenario=stack&writefail=1");
    await expect(page.getByTestId("editor-canvas")).toBeVisible();
    await page.waitForFunction(() => window.__lumengrabEditor?.ui.getState().view != null);
    await page.getByRole("radio", { name: "Presentation" }).click();
    await page.getByRole("radio", { name: "Animated", exact: true }).click();
    await page.getByRole("button", { name: "Open Background Studio" }).click();
    const studio = page.getByRole("dialog", { name: "Background Studio" });
    await studio.getByRole("button", { name: "Pause" }).click();
    await studio.getByRole("button", { name: "Export" }).click();
    const dialog = page.getByRole("dialog", { name: "Export" });
    await dialog.getByRole("radio", { name: "Picture" }).click();
    await dialog.getByRole("button", { name: "Export", exact: true }).click();
    await expect(dialog.getByText("The export did not work.")).toBeVisible();
    await expect(dialog.getByText("The folder is not writable.")).toBeVisible();
  });
});
