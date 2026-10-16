import { expect, test, type Page } from "@playwright/test";

test.use({ viewport: { width: 480, height: 470 } });

const submissions = (page: Page) => page.evaluate(() => window.__lumengrabMock?.submissions ?? []);

test.describe("update restart dialog (browser mock)", () => {
  test("it lists the documents with unsaved changes and Install and restart goes ahead", async ({
    page,
  }) => {
    await page.goto("/?window=update-restart");
    await expect(page.getByRole("heading", { name: "Install the update now?" })).toBeVisible();
    await expect(page.getByText("2 documents with unsaved changes")).toBeVisible();
    await expect(page.getByText("Screenshot_2026-10-14")).toBeVisible();
    await expect(page.getByText("Editor · Recovered work")).toBeVisible();
    await expect(page.getByText("Unsaved", { exact: true })).toHaveCount(2);
    await page.screenshot({
      path: "test-results/update-restart-dialog.png",
      animations: "disabled",
    });
    await page.getByRole("button", { name: "Install and restart" }).click();
    expect((await submissions(page)).some((e) => e.kind === "updateRestartConfirm")).toBe(true);
  });

  test("Later changes nothing, and one document is said in the singular", async ({ page }) => {
    await page.goto("/?window=update-restart&unsaved=1");
    await expect(page.getByText("1 document with unsaved changes")).toBeVisible();
    await page.getByRole("button", { name: "Later" }).click();
    const log = await submissions(page);
    expect(log.some((e) => e.kind === "updateRestartDismiss")).toBe(true);
    expect(log.some((e) => e.kind === "updateRestartConfirm")).toBe(false);
  });

  test("cancelling Save changes? in an editor tells the app that the restart is off", async ({
    page,
  }) => {
    await page.setViewportSize({ width: 1280, height: 880 });
    await page.goto("/?window=document&label=doc-1&scenario=stack");
    await expect(page.getByTestId("editor-canvas")).toBeVisible();
    // One change in the document (no mouse timing involved), so there is something unsaved.
    await page.evaluate(() => {
      window.__lumengrabEditor?.editor.getState().change((project) => {
        project.layers.push({
          id: "r1",
          visible: true,
          locked: false,
          type: "rect",
          x: 10,
          y: 10,
          width: 80,
          height: 40,
          rotation: 0,
          stroke: "#EF4444",
          fill: null,
          strokeWidth: 4,
          radius: 0,
        });
      });
    });
    await expect(page.getByTestId("unsaved-dot")).toBeVisible();
    // The app asks the page to close (as the window's close button does).
    await page.evaluate(() => {
      window.__lumengrabMock?.requestClose?.();
    });
    const dialog = page.getByRole("dialog", { name: "Unsaved changes" });
    await expect(dialog).toBeVisible();
    await dialog.getByRole("button", { name: "Cancel" }).click();
    expect((await submissions(page)).some((e) => e.kind === "docCloseCancelled")).toBe(true);
  });
});
