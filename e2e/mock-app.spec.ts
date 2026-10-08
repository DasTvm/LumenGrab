import { expect, test, type Page } from "@playwright/test";

// The mock frame is 1440x900 px. A 720x450 viewport makes the CSS->pixel ratio exactly 2.
test.use({ viewport: { width: 720, height: 450 } });

async function openOverlay(page: Page, mode: "area" | "window") {
  await page.goto(`/?window=overlay&session=mock&display=1&mode=${mode}`);
  await page.waitForFunction(() => {
    const img = document.querySelector("img");
    return img !== null && img.complete && img.naturalWidth > 0;
  });
}

const submissions = (page: Page) => page.evaluate(() => window.__lumengrabMock?.submissions ?? []);

test.describe("home (browser mock)", () => {
  test("shows the runtime and the three capture actions", async ({ page }) => {
    await page.goto("/");
    await expect(page.getByTestId("runtime")).toContainText("browser-mock");
    for (const name of [/Capture area/, /Capture window/, /Capture fullscreen/]) {
      await expect(page.getByRole("button", { name })).toBeVisible();
    }
    await page.screenshot({ path: "test-results/mock-home-light.png", animations: "disabled" });
  });

  test("area button opens the capture overlay", async ({ page }) => {
    await page.goto("/");
    await page.getByRole("button", { name: /Capture area/ }).click();
    await expect(page).toHaveURL(/window=overlay.*mode=area/);
  });

  test("fullscreen button reports the request", async ({ page }) => {
    await page.goto("/");
    await page.getByRole("button", { name: /Capture fullscreen/ }).click();
    await expect(page.getByText("Fullscreen capture requested")).toBeVisible();
  });
});

test.describe("capture overlay: area (browser mock)", () => {
  test("drag selects an area and submits exact frame pixels", async ({ page }) => {
    await openOverlay(page, "area");
    await expect(page.getByText("Drag to select an area")).toBeVisible();

    await page.mouse.move(100, 100);
    await page.mouse.down();
    await page.mouse.move(300, 250, { steps: 6 });
    // Live size readout is in output pixels (2x): 200x150 CSS = 400x300 px.
    await expect(page.getByTestId("selection-label")).toHaveText("400 × 300");
    await page.screenshot({
      path: "test-results/mock-overlay-area-light.png",
      animations: "disabled",
    });
    await page.emulateMedia({ colorScheme: "dark" });
    await page.screenshot({
      path: "test-results/mock-overlay-area-dark.png",
      animations: "disabled",
    });
    await page.mouse.up();

    expect(await submissions(page)).toEqual([
      {
        kind: "area",
        sessionId: "mock",
        displayId: 1,
        rect: { x: 200, y: 200, width: 400, height: 300 },
      },
    ]);
  });

  test("dragging in any direction gives the same rectangle", async ({ page }) => {
    await openOverlay(page, "area");
    await page.mouse.move(300, 250);
    await page.mouse.down();
    await page.mouse.move(100, 100, { steps: 4 });
    await page.mouse.up();
    const [first] = await submissions(page);
    expect(first?.rect).toEqual({ x: 200, y: 200, width: 400, height: 300 });
  });

  test("selection past the display edge is clamped to the frame", async ({ page }) => {
    await openOverlay(page, "area");
    await page.mouse.move(600, 400);
    await page.mouse.down();
    await page.mouse.move(719, 449, { steps: 3 });
    await page.mouse.up();
    const [first] = await submissions(page);
    expect(first?.rect).toEqual({ x: 1200, y: 800, width: 238, height: 98 });
  });

  test("a tiny drag (accidental click) is ignored and selecting continues", async ({ page }) => {
    await openOverlay(page, "area");
    await page.mouse.move(50, 50);
    await page.mouse.down();
    await page.mouse.move(52, 52);
    await page.mouse.up();
    expect(await submissions(page)).toEqual([]);
    await expect(page.getByText("Drag to select an area")).toBeVisible();
  });

  test("Escape and right click cancel", async ({ page }) => {
    await openOverlay(page, "area");
    await page.keyboard.press("Escape");
    expect(await submissions(page)).toEqual([{ kind: "cancel", sessionId: "mock" }]);
    await page.mouse.click(10, 10, { button: "right" });
    expect((await submissions(page)).map((s) => s.kind)).toEqual(["cancel", "cancel"]);
  });
});

test.describe("capture overlay: window (browser mock)", () => {
  test("hover highlights the frontmost window under the pointer, click captures it", async ({
    page,
  }) => {
    await openOverlay(page, "window");
    await expect(page.getByText("Click a window to capture it")).toBeVisible();

    await page.mouse.move(400, 300); // = frame pixel (800, 600): inside the front window and the back window
    await expect(page.getByTestId("selection-label")).toContainText(
      "Sheets · Quarterly report (842 × 370)",
    );
    await page.screenshot({
      path: "test-results/mock-overlay-window-light.png",
      animations: "disabled",
    });

    await page.mouse.move(100, 200); // = frame pixel (200, 400): only the back window
    await expect(page.getByTestId("selection-label")).toContainText(
      "Browser · Dashboard (1200 × 720)",
    );

    await page.mouse.move(10, 10); // outside every window
    await expect(page.getByTestId("selection-label")).toHaveCount(0);

    await page.mouse.move(400, 300);
    await page.mouse.down();
    expect(await submissions(page)).toEqual([{ kind: "window", sessionId: "mock", windowId: 101 }]);
  });

  test("keyboard: Tab cycles windows front to back, Enter captures, Escape cancels", async ({
    page,
  }) => {
    await openOverlay(page, "window");
    await page.keyboard.press("Tab");
    await expect(page.getByTestId("selection-label")).toContainText("Sheets");
    await page.keyboard.press("Tab");
    await expect(page.getByTestId("selection-label")).toContainText("Browser");
    await page.keyboard.press("Shift+Tab");
    await expect(page.getByTestId("selection-label")).toContainText("Sheets");
    await page.keyboard.press("Tab");
    await page.keyboard.press("Enter");
    expect(await submissions(page)).toEqual([{ kind: "window", sessionId: "mock", windowId: 102 }]);
  });
});

test.describe("capture overlay: error and empty states", () => {
  test("opened without a session shows an error with a way out", async ({ page }) => {
    await page.goto("/?window=overlay");
    await expect(page.getByRole("alert")).toContainText("without a session");
    await expect(page.getByRole("button", { name: "Close" })).toBeFocused();
  });
});

test("settings placeholder window renders", async ({ page }) => {
  await page.goto("/?window=settings");
  await expect(page.getByRole("heading", { name: "Settings" })).toBeVisible();
});
