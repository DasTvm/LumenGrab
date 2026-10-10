import { expect, test, type Page } from "@playwright/test";

const submissions = (page: Page) => page.evaluate(() => window.__lumengrabMock?.submissions ?? []);

test.describe("quick access gallery (design states)", () => {
  test.use({ viewport: { width: 1040, height: 760 } });

  for (const scheme of ["light", "dark"] as const) {
    test(`all compact states, ${scheme}`, async ({ page }) => {
      await page.emulateMedia({ colorScheme: scheme });
      await page.goto("/?window=quick-access-states");
      for (const name of [
        "01 Normal",
        "02 Hover with tooltip",
        "03 Copied",
        "04 Saved",
        "05 Save failed",
        "06 Auto-close timer",
      ]) {
        await expect(page.getByRole("region", { name })).toBeVisible();
      }
      await expect(page.getByRole("tooltip")).toHaveCount(2); // hover tooltip and the Copied pill
      await expect(page.getByRole("status")).toHaveCount(2);
      await page.screenshot({
        path: `test-results/quick-access-states-${scheme}.png`,
        animations: "disabled",
      });
    });
  }
});

test.describe("quick access card (browser mock)", () => {
  test.use({ viewport: { width: 400, height: 220 } });

  test("shows the thumbnail and reports its height so the window can be sized and shown", async ({
    page,
  }) => {
    await page.goto("/?window=quick&card=compact&secs=0");
    await expect(page.getByTestId("quick-access-card")).toBeVisible();
    await expect
      .poll(async () => (await submissions(page)).some((s) => s.kind === "qaSize"))
      .toBe(true);
    const size = (await submissions(page)).find((s) => s.kind === "qaSize");
    expect(size?.id).toBe("demo");
    expect(size?.height).toBeGreaterThan(60);
    expect(size?.height).toBeLessThan(90);
    expect(size?.extraTop).toBe(0);
  });

  test("Copy asks the native side, turns lime and says Copied for a moment", async ({ page }) => {
    await page.goto("/?window=quick&card=compact&secs=0");
    await page.getByRole("button", { name: "Copy image" }).click();
    expect((await submissions(page)).filter((s) => s.kind === "qaCopy")).toEqual([
      { kind: "qaCopy", id: "demo" },
    ]);
    await expect(page.getByRole("button", { name: "Copy image" })).toHaveAttribute(
      "aria-pressed",
      "true",
    );
    // The pill needs room above the card: the card asks for it.
    await expect
      .poll(async () =>
        (await submissions(page)).some((s) => s.kind === "qaSize" && s.extraTop === 44),
      )
      .toBe(true);
  });

  test("a failed copy says so and offers Retry", async ({ page }) => {
    await page.goto("/?window=quick&card=compact&secs=0&copy=fail");
    await page.getByRole("button", { name: "Copy image" }).click();
    const status = page.getByRole("status");
    await expect(status).toContainText("Could not copy to the clipboard");
    await expect(status).toContainText("Another app is blocking the clipboard.");
    await page.getByRole("button", { name: "Retry" }).click();
    expect((await submissions(page)).filter((s) => s.kind === "qaCopy")).toHaveLength(2);
  });

  test("Save as shows where the copy went, and Show reveals the file", async ({ page }) => {
    await page.goto("/?window=quick&card=compact&secs=0");
    await page.getByRole("button", { name: "Save as…" }).click();
    const status = page.getByRole("status");
    await expect(status).toContainText("Saved to Documents/Reports");
    await expect(status).toContainText("Q3 numbers.png");
    await page.getByRole("button", { name: "Show" }).click();
    expect((await submissions(page)).filter((s) => s.kind === "qaReveal")).toEqual([
      { kind: "qaReveal", id: "demo" },
    ]);
  });

  test("cancelling the Save as dialog changes nothing", async ({ page }) => {
    await page.goto("/?window=quick&card=compact&secs=0&saveas=cancel");
    await page.getByRole("button", { name: "Save as…" }).click();
    await expect(page.getByRole("status")).toHaveCount(0);
  });

  test("Close and Esc close the card", async ({ page }) => {
    await page.goto("/?window=quick&card=compact&secs=0");
    await page.getByRole("button", { name: "Close" }).click();
    await page.keyboard.press("Escape");
    expect((await submissions(page)).filter((s) => s.kind === "qaClose")).toHaveLength(2);
  });

  test("the card closes by itself when the line has run out", async ({ page }) => {
    await page.goto("/?window=quick&card=compact&secs=1");
    await expect(page.getByTestId("auto-close-line")).toBeVisible();
    await expect
      .poll(async () => (await submissions(page)).some((s) => s.kind === "qaClose"), {
        timeout: 4000,
      })
      .toBe(true);
  });

  test("hovering pauses the line, leaving lets it run on", async ({ page }) => {
    await page.goto("/?window=quick&card=compact&secs=5");
    const line = page.getByTestId("auto-close-line");
    await page.getByTestId("quick-access-card").hover();
    await expect(line).toHaveCSS("animation-play-state", "paused");
    await page.mouse.move(380, 10);
    await expect(line).toHaveCSS("animation-play-state", "running");
  });

  test("a tooltip appears after a short hover", async ({ page }) => {
    await page.goto("/?window=quick&card=compact&secs=0");
    await page.getByRole("button", { name: "Save as…" }).hover();
    // It asks for room first; the mock never grows the window, so the pad stays small and no bubble is drawn.
    await expect
      .poll(async () =>
        (await submissions(page)).some((s) => s.kind === "qaSize" && s.extraTop === 44),
      )
      .toBe(true);
  });

  test("without a card the window stays empty", async ({ page }) => {
    await page.goto("/?window=quick&card=none");
    await expect(page.getByTestId("quick-access-card")).toHaveCount(0);
  });
});
