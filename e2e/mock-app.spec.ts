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
    await expect(page.getByText("Drag to select")).toBeVisible();

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
    await expect(page.getByText("Drag to select")).toBeVisible();
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
    await expect(page.getByText("Click a window")).toBeVisible();

    await page.mouse.move(400, 300); // = frame pixel (800, 600): inside the front window and the back window
    await expect(page.getByTestId("selection-label")).toContainText(
      "Sheets · Quarterly report · 842 × 370",
    );
    await page.screenshot({
      path: "test-results/mock-overlay-window-light.png",
      animations: "disabled",
    });

    await page.mouse.move(100, 200); // = frame pixel (200, 400): only the back window
    await expect(page.getByTestId("selection-label")).toContainText(
      "Browser · Dashboard · 1200 × 720",
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

test.describe("capture overlay: toolbar and Space to move (browser mock)", () => {
  test("the toolbar switches between area and window mode", async ({ page }) => {
    await openOverlay(page, "area");
    await expect(page.getByRole("button", { name: "Area" })).toHaveAttribute(
      "aria-pressed",
      "true",
    );
    await page.getByRole("button", { name: "Window" }).click();
    await expect(page.getByRole("button", { name: "Window" })).toHaveAttribute(
      "aria-pressed",
      "true",
    );
    await expect(page.getByText("Click a window")).toBeVisible();
    await page.mouse.move(400, 300);
    await expect(page.getByTestId("selection-label")).toContainText("Sheets");
    await page.screenshot({
      path: "test-results/mock-overlay-toolbar-light.png",
      animations: "disabled",
    });
    await page.getByRole("button", { name: "Area" }).click();
    await expect(page.getByText("Drag to select")).toBeVisible();
  });

  test("keyboard shortcuts A / W switch the mode", async ({ page }) => {
    await openOverlay(page, "area");
    await page.keyboard.press("w");
    await expect(page.getByRole("button", { name: "Window" })).toHaveAttribute(
      "aria-pressed",
      "true",
    );
    await page.keyboard.press("a");
    await expect(page.getByRole("button", { name: "Area" })).toHaveAttribute(
      "aria-pressed",
      "true",
    );
  });

  test("Fullscreen captures the whole display of this overlay", async ({ page }) => {
    await openOverlay(page, "area");
    await page.getByRole("button", { name: "Fullscreen" }).click();
    expect(await submissions(page)).toEqual([
      {
        kind: "area",
        sessionId: "mock",
        displayId: 1,
        rect: { x: 0, y: 0, width: 1440, height: 900 },
      },
    ]);
  });

  test("the close button cancels", async ({ page }) => {
    await openOverlay(page, "area");
    await page.getByRole("button", { name: "Cancel capture" }).click();
    expect(await submissions(page)).toEqual([{ kind: "cancel", sessionId: "mock" }]);
  });

  test("clicking the toolbar does not start a selection", async ({ page }) => {
    await openOverlay(page, "area");
    const box = await page.getByRole("button", { name: "Window" }).boundingBox();
    if (!box) throw new Error("toolbar not visible");
    await page.mouse.move(box.x + 5, box.y + 5);
    await page.mouse.down();
    await page.mouse.move(box.x + 100, box.y - 100, { steps: 4 });
    await page.mouse.up();
    expect(await submissions(page)).toEqual([]);
  });

  test("a drag shows the 8 handles, Space moves the selection instead of resizing it", async ({
    page,
  }) => {
    await openOverlay(page, "area");
    await page.mouse.move(100, 100);
    await page.mouse.down();
    await page.mouse.move(300, 250, { steps: 6 });
    await expect(page.getByTestId("handle")).toHaveCount(8);
    await page.keyboard.down("Space");
    await page.mouse.move(350, 300, { steps: 4 }); // +50, +50 while Space is held
    await page.keyboard.up("Space");
    await expect(page.getByTestId("selection-label")).toHaveText("400 × 300"); // size unchanged
    await page.mouse.up();
    const [first] = await submissions(page);
    expect(first?.rect).toEqual({ x: 300, y: 300, width: 400, height: 300 });
  });

  test("Space cannot push the selection off the display", async ({ page }) => {
    await openOverlay(page, "area");
    // Drag from bottom-right to top-left, so the pointer sits on the selection's top-left corner.
    await page.mouse.move(500, 300);
    await page.mouse.down();
    await page.mouse.move(300, 200, { steps: 4 });
    await page.keyboard.down("Space");
    await page.mouse.move(700, 200, { steps: 4 }); // +400 px wide, but only 220 of room to the right
    await page.keyboard.up("Space");
    await expect(page.getByTestId("selection-label")).toHaveText("400 × 200"); // size unchanged
    await page.mouse.up();
    const [first] = await submissions(page);
    expect(first?.rect).toEqual({ x: 1040, y: 400, width: 400, height: 200 });
  });
});

test.describe("capture overlay: error and empty states", () => {
  test("opened without a session shows an error with a way out", async ({ page }) => {
    await page.goto("/?window=overlay");
    await expect(page.getByRole("alert")).toContainText("without a session");
    await expect(page.getByRole("button", { name: "Close" })).toBeFocused();
  });
});

test("overlay at the design size (1280x800) for visual comparison with LumenGrab.pen", async ({
  page,
}) => {
  await page.setViewportSize({ width: 1280, height: 800 });
  await openOverlay(page, "area");
  await page.mouse.move(300, 200);
  await page.mouse.down();
  await page.mouse.move(860, 530, { steps: 8 });
  await page.screenshot({
    path: "test-results/design-compare-overlay-area.png",
    animations: "disabled",
  });
  await page.mouse.up();
});
