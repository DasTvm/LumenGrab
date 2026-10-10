import { expect, test, type Page } from "@playwright/test";

test.use({ viewport: { width: 980, height: 700 } });

const submissions = (page: Page) => page.evaluate(() => window.__lumengrabMock?.submissions ?? []);
const open = (page: Page, query: string) => page.goto(`/?window=document&label=doc-1&${query}`);

test.describe("document window (browser mock)", () => {
  test("a normal document: preview, what is in the file, no notices", async ({ page }) => {
    await open(page, "scenario=ready");
    await expect(
      page.getByRole("heading", { name: "Screenshot 2026-10-09 at 14.02.lumengrab" }),
    ).toBeVisible();
    await expect(page.getByTestId("doc-size")).toHaveText("1440 × 900 px");
    await expect(page.getByTestId("doc-layers")).toHaveText("No layers");
    await expect(page.getByTestId("doc-preview")).toBeVisible();
    await expect(page.getByRole("list", { name: "Notices" })).toHaveCount(0);
    await expect(page.getByText("Read-only")).toHaveCount(0);
    await expect(page.getByRole("button", { name: "Export as PNG" })).toBeEnabled();
    await page.screenshot({
      path: "test-results/document-ready-light.png",
      animations: "disabled",
    });
  });

  test("the preview image is really decoded (not a broken image)", async ({ page }) => {
    await open(page, "scenario=ready");
    const img = page.getByTestId("doc-preview");
    await expect(img).toBeVisible();
    await expect
      .poll(() => img.evaluate((el: HTMLImageElement) => el.naturalWidth))
      .toBeGreaterThan(100);
  });

  test("export writes a flat PNG through the granted place and says where it went", async ({
    page,
  }) => {
    await open(page, "scenario=redactions");
    await expect(page.getByTestId("doc-layers")).toHaveText("2 layers");
    await page.getByRole("button", { name: "Export as PNG" }).click();
    await expect(page.getByRole("status").last()).toContainText(
      "Saved Screenshot 2026-10-09 at 14.02.png to Documents/Reports.",
    );
    const log = await submissions(page);
    expect(log.find((s) => s.kind === "pickSave")).toMatchObject({
      name: "Screenshot 2026-10-09 at 14.02.png",
      formats: ["png"],
    });
    expect(log.find((s) => s.kind === "writeFile")?.size).toBeGreaterThan(1000);
    const signature = await page.evaluate(() =>
      Array.from(window.__lumengrabMock?.written?.["t1"]?.slice(0, 8) ?? []),
    );
    expect(signature).toEqual([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
  });

  test("cancelling the save dialog writes nothing", async ({ page }) => {
    await open(page, "scenario=ready&cancel=1");
    await page.getByRole("button", { name: "Export as PNG" }).click();
    await expect(page.getByRole("button", { name: "Export as PNG" })).toBeEnabled();
    expect((await submissions(page)).filter((s) => s.kind === "writeFile")).toHaveLength(0);
  });

  test("a write that fails says why", async ({ page }) => {
    await open(page, "scenario=ready&writefail=1");
    await page.getByRole("button", { name: "Export as PNG" }).click();
    await expect(page.getByText("The folder is not writable.")).toBeVisible();
  });

  test("a document with annotations cannot be exported yet, and says why", async ({ page }) => {
    await open(page, "scenario=annotated");
    await expect(page.getByTestId("doc-layers")).toHaveText("1 layer");
    await expect(page.getByRole("button", { name: "Export as PNG" })).toBeDisabled();
    await expect(
      page.getByText("This file has annotations. Exporting them comes with the editor."),
    ).toBeVisible();
  });

  test("warnings are shown as notices and the file still opens", async ({ page }) => {
    await open(page, "scenario=warnings");
    const notices = page.getByRole("list", { name: "Notices" });
    await expect(notices).toContainText("does not match its checksum");
    await expect(notices).toContainText("background image of this file is missing");
    await expect(page.getByTestId("doc-preview")).toBeVisible();
    await page.screenshot({
      path: "test-results/document-warnings-light.png",
      animations: "disabled",
    });
  });

  test("a damaged file shows the Can't open dialog with the exact problem, and Show/Close work", async ({
    page,
  }) => {
    await open(page, "scenario=corrupt");
    const dialog = page.getByRole("alertdialog", { name: "Can't open this file" });
    await expect(dialog).toContainText(
      "The file is damaged or incomplete. Your original file was not changed.",
    );
    await expect(page.getByTestId("document-dialog-detail")).toHaveText(
      "project.json: invalid or missing field “layers”",
    );
    await page.screenshot({
      path: "test-results/document-cant-open-light.png",
      animations: "disabled",
    });
    await dialog.getByRole("button", { name: /^Show in / }).click();
    await dialog.getByRole("button", { name: "Close" }).click();
    expect((await submissions(page)).map((s) => s.kind)).toEqual(["docReveal", "docClose"]);
  });

  test("a truncated file is reported as damaged, not as a crash", async ({ page }) => {
    await open(page, "scenario=truncated");
    await expect(page.getByRole("alertdialog", { name: "Can't open this file" })).toBeVisible();
    await expect(page.getByTestId("document-dialog-detail")).not.toBeEmpty();
  });

  test("a file from a newer version opens read-only: dialog, then a viewer with a Read-only badge", async ({
    page,
  }) => {
    await open(page, "scenario=readonly");
    const dialog = page.getByRole("alertdialog", { name: "Opened read-only" });
    await expect(dialog).toContainText("created with a newer version of LumenGrab");
    await expect(page.getByTestId("document-dialog-detail")).toHaveText(
      "File version 4 · LumenGrab supports up to 1",
    );
    await page.screenshot({
      path: "test-results/document-read-only-light.png",
      animations: "disabled",
    });

    await dialog.getByRole("button", { name: "Check for updates" }).click();
    expect((await submissions(page)).find((s) => s.kind === "openUrl")?.url).toBe(
      "https://github.com/DasTvm/LumenGrab/releases",
    );

    await dialog.getByRole("button", { name: "Keep viewing" }).click();
    await expect(page.getByText("Read-only")).toBeVisible();
    await expect(page.getByTestId("doc-preview")).toBeVisible(); // viewed from the preview in the file
    await expect(page.getByTestId("doc-layers")).toHaveText("Layers unavailable");
    // Editing is off; the only export is the file's own (already flat) preview.
    await expect(page.getByRole("button", { name: "Export preview as PNG" })).toBeEnabled();
  });

  test("a read-only file exports its own preview, never a render of data it cannot understand", async ({
    page,
  }) => {
    await open(page, "scenario=readonly");
    await page.getByRole("button", { name: "Keep viewing" }).click();
    await page.getByRole("button", { name: "Export preview as PNG" }).click();
    await expect(page.getByRole("status").last()).toContainText(
      "Saved Screenshot 2026-10-09 at 14.02.png",
    );
    const signature = await page.evaluate(() =>
      Array.from(window.__lumengrabMock?.written?.["t1"]?.slice(0, 4) ?? []),
    );
    expect(signature).toEqual([0x89, 0x50, 0x4e, 0x47]);
  });
});
