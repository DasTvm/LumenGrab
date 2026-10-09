import { expect, test, type Page } from "@playwright/test";

// Design size of "Onboarding Permission" in LumenGrab.pen.
test.use({ viewport: { width: 900, height: 600 } });

const submissions = (page: Page) => page.evaluate(() => window.__lumengrabMock?.submissions ?? []);

test.describe("permission window (browser mock)", () => {
  test("explains the three steps and offers the two actions", async ({ page }) => {
    await page.goto("/?window=permission");
    await expect(page.getByRole("heading", { name: "Allow screen recording" })).toBeVisible();
    await expect(page.getByRole("listitem")).toHaveCount(3);
    await expect(page.getByRole("button", { name: "Open System Settings" })).toBeVisible();
    await expect(page.getByRole("button", { name: "Check again" })).toBeEnabled();
    await expect(page.getByText("No account, no telemetry, no cloud.")).toBeVisible();
    await expect(page.getByTestId("stale-hint")).toContainText("Already switched on");
    await page.screenshot({ path: "test-results/permission-light.png", animations: "disabled" });
    await page.emulateMedia({ colorScheme: "dark" });
    await page.screenshot({ path: "test-results/permission-dark.png", animations: "disabled" });
  });

  test("Open System Settings asks the native side and moves to step 2", async ({ page }) => {
    await page.goto("/?window=permission");
    await page.getByRole("button", { name: "Open System Settings" }).click();
    expect(await submissions(page)).toEqual([{ kind: "openPermissionSettings" }]);
    await expect(page.getByRole("listitem").nth(1)).toHaveAttribute("aria-current", "step");
  });

  test("Check again without the permission says so", async ({ page }) => {
    await page.goto("/?window=permission");
    await expect(page.getByTestId("not-yet")).toHaveCount(0);
    await page.getByRole("button", { name: "Check again" }).click();
    await expect(page.getByTestId("not-yet")).toContainText("Not allowed yet");
  });

  test("when the permission is granted the window turns into a confirmation", async ({ page }) => {
    await page.goto("/?window=permission&granted=1");
    await expect(page.getByRole("heading", { name: "Screen recording is on" })).toBeVisible();
    await expect(page.getByText("Permission granted")).toBeVisible();
    await expect(page.getByRole("button", { name: "Open System Settings" })).toHaveCount(0);
    await page.screenshot({ path: "test-results/permission-granted.png", animations: "disabled" });
    await page.getByRole("button", { name: "Restart LumenGrab" }).click();
    await page.getByRole("button", { name: "Done" }).click();
    expect((await submissions(page)).map((s) => s.kind)).toEqual(["restart", "closePermission"]);
  });

  test("the inline restart link works when the permission still fails", async ({ page }) => {
    await page.goto("/?window=permission");
    await page.getByRole("button", { name: "restart LumenGrab" }).click();
    expect(await submissions(page)).toEqual([{ kind: "restart" }]);
  });
});
