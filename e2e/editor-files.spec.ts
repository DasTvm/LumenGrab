import { expect, test, type Page } from "@playwright/test";
import { openDocument } from "../src/document/read";

test.use({ viewport: { width: 1280, height: 880 } });

const open = (page: Page, query = "scenario=stack") =>
  page.goto(`/?window=document&label=doc-1&${query}`);
const ready = async (page: Page) => {
  await expect(page.getByTestId("editor-canvas")).toBeVisible();
  await page.waitForFunction(() => window.__lumengrabEditor?.ui.getState().view != null);
};
const submissions = (page: Page) => page.evaluate(() => window.__lumengrabMock?.submissions ?? []);
const kinds = async (page: Page) => (await submissions(page)).map((s) => s.kind);
const written = (page: Page, token = "t1") =>
  page.evaluate((t) => Array.from(window.__lumengrabMock?.written?.[t] ?? []), token);
const dialog = (page: Page, name: string) => page.getByRole("dialog", { name });

/** Draws a rectangle by mouse (one change, so the document becomes dirty). */
async function scribble(page: Page) {
  await page.getByRole("button", { name: "Rectangle", exact: true }).click();
  const area = await page.getByTestId("editor-canvas-area").boundingBox();
  if (!area) throw new Error("no canvas");
  await page.mouse.move(area.x + 200, area.y + 300);
  await page.mouse.down();
  await page.mouse.move(area.x + 320, area.y + 380, { steps: 4 });
  await page.mouse.up();
}

test.describe("save (browser mock)", () => {
  test("Cmd/Ctrl+S saves a file in place: the same file, with the edits, the dot goes away", async ({
    page,
  }) => {
    await open(page);
    await ready(page);
    await scribble(page);
    await expect(page.getByTestId("unsaved-dot")).toBeVisible();
    await page.keyboard.press("ControlOrMeta+s");
    await expect(page.getByTestId("feedback-pill")).toHaveText("Saved");
    await expect(page.getByTestId("unsaved-dot")).toHaveCount(0);
    const saved = await page.evaluate(() =>
      Array.from(window.__lumengrabMock?.saved?.["doc-1"] ?? []),
    );
    expect(saved.length).toBeGreaterThan(1000);
    // The bytes are a real document: the original layers plus the new rectangle, a preview, the same source.
    const reopened = await openDocument(new Uint8Array(saved));
    expect(reopened.doc.project?.layers).toHaveLength(5);
    expect(reopened.doc.preview).not.toBeNull();
    expect(reopened.warnings).toEqual([]);
    expect(await kinds(page)).toContain("docSave");
    expect(await kinds(page)).not.toContain("pickSave"); // it did not ask where
    // The pill fades after two seconds.
    await expect(page.getByTestId("feedback-pill")).toHaveCount(0, { timeout: 4000 });
  });

  test("the file stays dirty-free when only the viewport changes, and the native side is told about every change", async ({
    page,
  }) => {
    await open(page);
    await ready(page);
    await page.getByRole("button", { name: "Zoom in" }).click();
    await expect(page.getByTestId("unsaved-dot")).toHaveCount(0);
    await scribble(page);
    await page.keyboard.press("ControlOrMeta+s");
    await expect(page.getByTestId("feedback-pill")).toBeVisible();
    const flags = (await submissions(page)).filter((s) => s.kind === "docDirty").map((s) => s.flag);
    // (React's dev mode starts the watcher twice: the same flag may be sent twice in a row.)
    expect(flags.filter((f, i) => f !== flags[i - 1])).toEqual([false, true, false]);
  });

  test("a save that fails says why and offers Retry and Save elsewhere", async ({ page }) => {
    await open(page, "scenario=stack&savefail=1");
    await ready(page);
    await scribble(page);
    await page.keyboard.press("ControlOrMeta+s");
    const failure = dialog(page, "Could not save");
    await expect(failure).toBeVisible();
    await expect(failure).toContainText("Your work is still open. Nothing was lost.");
    await expect(page.getByTestId("failure-reason")).toHaveText(
      "There is not enough space on the disk.",
    );
    await expect(failure).toContainText("Details: no space left on device (os error 28)");
    await expect(page.getByTestId("unsaved-dot")).toBeVisible(); // still unsaved
    await page.screenshot({
      path: "test-results/editor-could-not-save-light.png",
      animations: "disabled",
    });
    await failure.getByRole("button", { name: "Save elsewhere…" }).click();
    expect(await kinds(page)).toContain("pickSave");
    await expect
      .poll(() => page.getByTestId("editor-file-name").textContent())
      .toContain(".lumengrab");
  });
});

test.describe("an edited screenshot that is not a document yet (browser mock)", () => {
  const openCapture = (page: Page, extra = "") => open(page, `kind=capture${extra}`);

  test("opens clean, with the capture's name; the first Cmd/Ctrl+S asks where and the window becomes that file", async ({
    page,
  }) => {
    await openCapture(page);
    await ready(page);
    await expect(page.getByTestId("editor-file-name")).toHaveText("Screenshot 2026-10-09 at 14.02");
    await expect(page.getByTestId("unsaved-dot")).toHaveCount(0);
    await scribble(page);
    await page.keyboard.press("ControlOrMeta+s");
    const dlg = dialog(page, "Export");
    await expect(dlg).toBeVisible();
    await expect(dlg.getByRole("radio", { name: ".lumengrab" })).toHaveAttribute(
      "aria-checked",
      "true",
    );
    await expect(dlg.getByRole("textbox", { name: "File name" })).toHaveValue(
      "Screenshot 2026-10-09 at 14.02.lumengrab",
    );
    await expect(dlg).toContainText(
      "Crop, annotations and presentation are saved on top of the untouched original",
    );
    await page.screenshot({
      path: "test-results/editor-export-lumengrab-light.png",
      animations: "disabled",
    });
    await dlg.getByRole("button", { name: "Save .lumengrab" }).click();
    await expect(page.getByTestId("feedback-pill")).toHaveText("Saved");
    expect((await submissions(page)).find((s) => s.kind === "pickSave")).toMatchObject({
      formats: ["lumengrab"],
    });
    expect((await submissions(page)).find((s) => s.kind === "docBind")).toMatchObject({
      id: "doc-1",
      name: "t1",
    });
    await expect(page.getByTestId("editor-file-name")).toHaveText(
      "Screenshot 2026-10-09 at 14.02.lumengrab",
    );
    const bytes = await written(page);
    const reopened = await openDocument(new Uint8Array(bytes));
    expect(reopened.doc.project?.layers).toHaveLength(1);
    expect(reopened.doc.manifest.createdBy).toContain("LumenGrab");
    // From now on Save writes to that file.
    await scribble(page);
    await page.keyboard.press("ControlOrMeta+s");
    await expect.poll(async () => (await kinds(page)).includes("docSave")).toBe(true);
  });

  test("a .lumengrab with redactions warns that it keeps the original pixels, and offers a flat PNG instead", async ({
    page,
  }) => {
    await openCapture(page);
    await ready(page);
    await page.getByRole("button", { name: "Redaction", exact: true }).click();
    const area = await page.getByTestId("editor-canvas-area").boundingBox();
    if (!area) throw new Error("no canvas");
    await page.mouse.move(area.x + 200, area.y + 300);
    await page.mouse.down();
    await page.mouse.move(area.x + 320, area.y + 380, { steps: 4 });
    await page.mouse.up();
    await page.keyboard.press("ControlOrMeta+s");
    const dlg = dialog(page, "Export");
    await expect(dlg.getByRole("note")).toContainText("This file keeps your original pixels");
    await expect(dlg.getByRole("note")).toContainText(
      "1 redaction is saved as editable layers on top of the unredacted original",
    );
    await page.screenshot({
      path: "test-results/editor-export-warning-light.png",
      animations: "disabled",
    });
    await dlg.getByRole("button", { name: "Export flat PNG instead" }).click();
    await expect(dlg.getByRole("radio", { name: "PNG" })).toHaveAttribute("aria-checked", "true");
    await expect(dlg).toContainText(
      "1 redaction is burned into the image. The pixels underneath are gone.",
    );
    await expect(dlg.getByRole("textbox", { name: "File name" })).toHaveValue(
      "Screenshot 2026-10-09 at 14.02.png",
    );
  });

  test("closing a capture nobody changed just closes it", async ({ page }) => {
    await openCapture(page);
    await ready(page);
    await page.evaluate(() => window.__lumengrabMock?.requestClose?.());
    await expect.poll(async () => (await kinds(page)).includes("docClose")).toBe(true);
    await expect(dialog(page, "Unsaved changes")).toHaveCount(0);
  });
});

test.describe("export and copy (browser mock)", () => {
  test.beforeEach(async ({ page }) => {
    await open(page);
    await ready(page);
    await page.getByRole("button", { name: "Export", exact: true }).click();
  });

  const exportDialog = (page: Page) => dialog(page, "Export");

  test("PNG: the size chips, the dimensions of the file, the note about the redaction", async ({
    page,
  }) => {
    const dlg = exportDialog(page);
    await expect(dlg).toContainText("Choose the format and size of the exported image.");
    await expect(dlg.getByRole("radio", { name: "1×" })).toHaveAttribute("aria-checked", "true");
    await expect(dlg.getByText("1440 × 900 px")).toBeVisible();
    await expect(dlg).toContainText(
      "1 redaction is burned into the image. The pixels underneath are gone.",
    );
    await dlg.getByRole("radio", { name: "0.5×" }).click();
    await expect(dlg.getByText("720 × 450 px")).toBeVisible();
    await dlg.getByRole("radio", { name: "2×" }).click();
    await dlg.getByRole("button", { name: "Save PNG" }).click();
    await expect(page.getByTestId("feedback-pill")).toHaveText("Saved");
    const head = await written(page);
    expect(head.slice(0, 8)).toEqual([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
    const view = new DataView(new Uint8Array(head).buffer);
    expect([view.getUint32(16), view.getUint32(20)]).toEqual([2880, 1800]);
    await page.screenshot({
      path: "test-results/editor-export-png-light.png",
      animations: "disabled",
    });
  });

  test("a custom size follows the ratio while locked and is free when unlocked", async ({
    page,
  }) => {
    const dlg = exportDialog(page);
    await dlg.getByRole("radio", { name: "Custom" }).click();
    const w = dlg.getByRole("textbox", { name: "Width" });
    await w.fill("720");
    await w.press("Enter");
    await expect(dlg.getByRole("textbox", { name: "Height" })).toHaveValue("450");
    await dlg.getByRole("button", { name: "Lock ratio" }).click();
    await dlg.getByRole("textbox", { name: "Height" }).fill("100");
    await dlg.getByRole("textbox", { name: "Height" }).press("Enter");
    await expect(dlg.getByRole("textbox", { name: "Width" })).toHaveValue("720");
    await expect(dlg.getByText("720 × 100 px")).toBeVisible();
  });

  test("JPG and WebP: a quality slider with the real size, and the right file", async ({
    page,
  }) => {
    const dlg = exportDialog(page);
    await dlg.getByRole("radio", { name: "JPG" }).click();
    await expect(dlg.getByRole("textbox", { name: "File name" })).toHaveValue(/\.jpg$/);
    await expect(dlg.getByText(/^90% · about \d+ KB$/)).toBeVisible();
    await dlg.getByRole("slider", { name: "Quality" }).fill("40");
    await expect(dlg.getByText(/^40% · about \d+ KB$/)).toBeVisible();
    await page.screenshot({
      path: "test-results/editor-export-jpg-light.png",
      animations: "disabled",
    });
    await dlg.getByRole("button", { name: "Save JPG" }).click();
    await expect(page.getByTestId("feedback-pill")).toHaveText("Saved");
    expect((await written(page)).slice(0, 3)).toEqual([0xff, 0xd8, 0xff]);

    await page.getByRole("button", { name: "Export", exact: true }).click();
    await exportDialog(page).getByRole("radio", { name: "WebP" }).click();
    await expect(exportDialog(page).getByText(/^85% · about \d+ KB$/)).toBeVisible();
    await exportDialog(page).getByRole("button", { name: "Save WebP" }).click();
    await expect.poll(async () => (await written(page)).length).toBeGreaterThan(100);
    const webp = await written(page);
    expect(String.fromCharCode(...webp.slice(0, 4))).toBe("RIFF");
    expect(String.fromCharCode(...webp.slice(8, 12))).toBe("WEBP");
  });

  test("the file name is editable and Esc closes the dialog; Cancel too", async ({ page }) => {
    const dlg = exportDialog(page);
    const name = dlg.getByRole("textbox", { name: "File name" });
    await name.fill("Checkout bug.png");
    await dlg.getByRole("button", { name: "Save PNG" }).click();
    expect((await submissions(page)).find((s) => s.kind === "pickSave")).toMatchObject({
      name: "Checkout bug.png",
      formats: ["png"],
    });
    await page.getByRole("button", { name: "Export", exact: true }).click();
    await page.keyboard.press("Escape");
    await expect(exportDialog(page)).toHaveCount(0);
    await page.getByRole("button", { name: "Export", exact: true }).click();
    await exportDialog(page).getByRole("button", { name: "Cancel" }).click();
    await expect(exportDialog(page)).toHaveCount(0);
  });

  test("Copy in the dialog and the copy button put the flat picture on the clipboard", async ({
    page,
  }) => {
    await exportDialog(page).getByRole("button", { name: "Copy" }).click();
    await expect(page.getByTestId("feedback-pill")).toHaveText("Copied to clipboard");
    const png = await page.evaluate(() =>
      Array.from(window.__lumengrabMock?.copied?.slice(0, 8) ?? []),
    );
    expect(png).toEqual([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
    await page.evaluate(() => {
      delete window.__lumengrabMock?.copied;
    });
    await page.getByRole("button", { name: "Copy image" }).click();
    await expect
      .poll(() => page.evaluate(() => window.__lumengrabMock?.copied?.length ?? 0))
      .toBeGreaterThan(1000);
  });

  test("a failed copy says so", async ({ page }) => {
    await page.keyboard.press("Escape");
    await page.goto("/?window=document&label=doc-1&scenario=stack&copyfail=1");
    await ready(page);
    await page.getByRole("button", { name: "Copy image" }).click();
    const failure = dialog(page, "Could not export");
    await expect(failure).toContainText("The image was not copied. Your document is unchanged.");
    await expect(failure).toContainText("Details: The clipboard is not available.");
  });
});

test.describe("closing with unsaved changes (browser mock)", () => {
  const close = (page: Page) => page.evaluate(() => window.__lumengrabMock?.requestClose?.());

  test("asks first: Cancel keeps the window, Don't save closes without saving and drops the recovery copy", async ({
    page,
  }) => {
    await open(page);
    await ready(page);
    await scribble(page);
    await close(page);
    const dlg = dialog(page, "Unsaved changes");
    await expect(dlg).toContainText("Save changes to “Screenshot 2026-10-09 at 14.02”?");
    await expect(dlg).toContainText("Your changes will be lost if you don't save them.");
    await page.screenshot({
      path: "test-results/editor-unsaved-light.png",
      animations: "disabled",
    });
    await dlg.getByRole("button", { name: "Cancel" }).click();
    await expect(dlg).toHaveCount(0);
    expect(await kinds(page)).not.toContain("docClose");
    await close(page);
    await dlg.getByRole("button", { name: "Don't save" }).click();
    await expect.poll(async () => (await kinds(page)).includes("docClose")).toBe(true);
    expect(await kinds(page)).not.toContain("docSave");
    expect(await kinds(page)).toContain("recoveryDelete");
  });

  test("Save writes the file and then closes the window", async ({ page }) => {
    await open(page);
    await ready(page);
    await scribble(page);
    await close(page);
    await dialog(page, "Unsaved changes")
      .getByRole("button", { name: "Save", exact: true })
      .click();
    await expect.poll(async () => (await kinds(page)).includes("docClose")).toBe(true);
    const order = await kinds(page);
    expect(order.indexOf("docSave")).toBeGreaterThan(-1);
    expect(order.indexOf("docSave")).toBeLessThan(order.indexOf("docClose"));
  });

  test("a failed save keeps the window open", async ({ page }) => {
    await open(page, "scenario=stack&savefail=1");
    await ready(page);
    await scribble(page);
    await close(page);
    await dialog(page, "Unsaved changes")
      .getByRole("button", { name: "Save", exact: true })
      .click();
    await expect(dialog(page, "Could not save")).toBeVisible();
    expect(await kinds(page)).not.toContain("docClose");
  });

  test("a clean document closes without asking", async ({ page }) => {
    await open(page);
    await ready(page);
    await close(page);
    await expect.poll(async () => (await kinds(page)).includes("docClose")).toBe(true);
  });
});

test.describe("autosave and recovery (browser mock)", () => {
  test("a recovery copy is written a few seconds after a change, and it is a complete document", async ({
    page,
  }) => {
    await page.clock.install();
    await open(page);
    await ready(page);
    await scribble(page);
    expect(await kinds(page)).not.toContain("recoveryWrite");
    await page.clock.fastForward(3500);
    await expect.poll(async () => (await kinds(page)).includes("recoveryWrite")).toBe(true);
    const copy = await page.evaluate(
      () => Object.values(window.__lumengrabMock?.recovery ?? {})[0],
    );
    expect(copy?.name).toBe("Screenshot 2026-10-09 at 14.02");
    const reopened = await openDocument(new Uint8Array(Object.values(copy?.bytes ?? {})));
    expect(reopened.doc.project?.layers).toHaveLength(5);
    // Saving removes it again.
    await page.keyboard.press("ControlOrMeta+s");
    await expect.poll(async () => (await kinds(page)).includes("recoveryDelete")).toBe(true);
  });

  test("several quick changes make one recovery copy, not one each", async ({ page }) => {
    await page.clock.install();
    await open(page);
    await ready(page);
    await scribble(page);
    await page.clock.fastForward(1500);
    await page.keyboard.press("Delete");
    await page.clock.fastForward(1500);
    await page.keyboard.press("ControlOrMeta+z");
    await page.clock.fastForward(1500);
    expect((await kinds(page)).filter((k) => k === "recoveryWrite")).toHaveLength(0);
    await page.clock.fastForward(2000);
    await expect
      .poll(async () => (await kinds(page)).filter((k) => k === "recoveryWrite").length)
      .toBe(1);
  });

  test("recovered work opens as unsaved: dirty from the start, Save asks where", async ({
    page,
  }) => {
    await open(page, "scenario=stack&kind=recovered");
    await ready(page);
    await expect(page.getByTestId("editor-file-name")).toHaveText("Checkout_error");
    await expect(page.getByTestId("unsaved-dot")).toBeVisible();
    await page.keyboard.press("ControlOrMeta+s");
    await expect(dialog(page, "Export")).toBeVisible();
  });
});

test.describe("the recovery window (browser mock)", () => {
  test.use({ viewport: { width: 620, height: 640 } });

  test("lists the copies the last session left, picks the changed ones, and recovers them", async ({
    page,
  }) => {
    await page.goto("/?window=recover&recoverable=3");
    const dlg = page.getByRole("dialog", { name: "Recover unsaved work" });
    await expect(dlg).toContainText(
      "LumenGrab closed before these captures were saved. Choose the ones you want back.",
    );
    const rows = dlg.getByRole("checkbox");
    await expect(rows).toHaveCount(3);
    await expect(rows.nth(0)).toContainText("Screenshot_2026-10-08");
    await expect(rows.nth(0)).toContainText("5 annotations, 1 redaction");
    await expect(rows.nth(1)).toContainText("Checkout_error");
    await expect(rows.nth(1)).toContainText("2 redactions");
    await expect(rows.nth(2)).toContainText("no changes yet");
    await expect(rows.nth(0)).toHaveAttribute("aria-checked", "true");
    await expect(rows.nth(2)).toHaveAttribute("aria-checked", "false");
    await expect(dlg.getByRole("button", { name: "Recover 2" })).toBeVisible();
    await page.screenshot({
      path: "test-results/editor-recover-light.png",
      animations: "disabled",
    });
    await rows.nth(2).click();
    await dlg.getByRole("button", { name: "Recover 3" }).click();
    expect((await submissions(page)).find((s) => s.kind === "recoveryOpen")?.ids).toEqual([
      "recovered-1",
      "recovered-2",
      "recovered-3",
    ]);
  });

  test("Discard all removes every copy and closes", async ({ page }) => {
    await page.goto("/?window=recover&recoverable=2");
    await page.getByRole("button", { name: "Discard all" }).click();
    await expect.poll(async () => (await kinds(page)).includes("recoveryClose")).toBe(true);
    expect((await submissions(page)).find((s) => s.kind === "recoveryDelete")?.ids).toEqual([
      "recovered-1",
      "recovered-2",
    ]);
  });

  test("with nothing left it says so", async ({ page }) => {
    await page.goto("/?window=recover");
    await expect(page.getByText("Nothing to recover")).toBeVisible();
    await page.getByRole("button", { name: "Close" }).click();
    await expect.poll(async () => (await kinds(page)).includes("recoveryClose")).toBe(true);
  });
});
