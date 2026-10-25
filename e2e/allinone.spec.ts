import { expect, test, type Page } from "@playwright/test";

// The mock frame is 1440x900 px: with this viewport one CSS pixel is one frame pixel.
test.use({ viewport: { width: 1440, height: 900 } });

async function open(page: Page, mode: string, query = "") {
  await page.goto(
    `/?window=overlay&session=mock&display=1&mode=${mode}&toolbar=1${query ? `&${query}` : ""}`,
  );
  await page.waitForFunction(() => {
    const img = document.querySelector("img");
    return img !== null && img.complete && img.naturalWidth > 0;
  });
  await expect(page.getByRole("toolbar", { name: "Capture mode" })).toBeVisible();
}

const submissions = (page: Page) => page.evaluate(() => window.__lumengrabMock?.submissions ?? []);

test.describe("all-in-one overlay (browser mock)", () => {
  test("rest: the bar offers every way, Scroll says Soon, the hint says what to do", async ({
    page,
  }) => {
    await open(page, "allinone");
    const bar = page.getByRole("toolbar", { name: "Capture mode" });
    for (const name of ["All-in-one", "Area", "Window", "Fullscreen", "Text"]) {
      await expect(bar.getByRole("button", { name })).toBeVisible();
    }
    await expect(bar.getByRole("button", { name: "All-in-one" })).toHaveAttribute(
      "aria-pressed",
      "true",
    );
    await expect(bar.getByRole("button", { name: "Scroll (coming soon)" })).toBeDisabled();
    await expect(page.getByText("Click a window or drag an area")).toBeVisible();
    await page.screenshot({ path: "test-results/allinone-rest.png", animations: "disabled" });
  });

  test("over a window: it is outlined and named, a click takes that window", async ({ page }) => {
    await open(page, "allinone");
    await page.mouse.move(700, 450);
    await expect(page.getByTestId("selection-label")).toContainText(
      "Sheets · Quarterly report · 842 × 370",
    );
    await expect(page.getByText("Click to capture this window")).toBeVisible();
    await page.screenshot({ path: "test-results/allinone-window.png", animations: "disabled" });
    await page.mouse.down();
    await page.mouse.up();
    expect(await submissions(page)).toEqual([{ kind: "window", sessionId: "mock", windowId: 101 }]);
  });

  test("a click on bare desktop does nothing; a click that moves a hair is still a click", async ({
    page,
  }) => {
    await open(page, "allinone");
    await page.mouse.move(20, 20);
    await page.mouse.down();
    await page.mouse.up();
    expect(await submissions(page)).toEqual([]);
    await page.mouse.move(700, 450);
    await page.mouse.down();
    await page.mouse.move(702, 451);
    await page.mouse.up();
    expect(await submissions(page)).toEqual([{ kind: "window", sessionId: "mock", windowId: 101 }]);
  });

  test("a drag takes an area: handles, the size, and the area is sent", async ({ page }) => {
    await open(page, "allinone");
    await page.mouse.move(200, 150);
    await page.mouse.down();
    await page.mouse.move(700, 450, { steps: 6 });
    await expect(page.getByTestId("handle")).toHaveCount(8);
    await expect(page.getByTestId("selection-label")).toHaveText("500 × 300");
    await page.screenshot({ path: "test-results/allinone-drag.png", animations: "disabled" });
    await page.mouse.up();
    const [first] = await submissions(page);
    expect(first).toMatchObject({
      kind: "area",
      rect: { x: 200, y: 150, width: 500, height: 300 },
    });
  });

  test("Tab cycles the windows and Enter takes the one chosen", async ({ page }) => {
    await open(page, "allinone");
    await page.keyboard.press("Tab");
    await expect(page.getByTestId("selection-label")).toContainText("Sheets");
    await page.keyboard.press("Tab");
    await expect(page.getByTestId("selection-label")).toContainText("Browser");
    await page.keyboard.press("Enter");
    expect(await submissions(page)).toEqual([{ kind: "window", sessionId: "mock", windowId: 102 }]);
  });
});

test.describe("repeat the last area (browser mock)", () => {
  test("with a remembered size an outline follows the pointer and R takes it", async ({ page }) => {
    await open(page, "allinone", "last=1280x720");
    // Away from every window, the outline of the last size sits on the pointer.
    await page.mouse.move(40, 40);
    await expect(page.getByTestId("repeat-outline")).toBeVisible();
    await expect(page.getByTestId("repeat-label")).toHaveText("1280 × 720");
    await expect(page.getByText("Press R to take this area again")).toBeVisible();
    await page.screenshot({ path: "test-results/allinone-repeat.png", animations: "disabled" });
    await page.keyboard.press("r");
    const [first] = await submissions(page);
    // Centred on the pointer, but kept on the display: the corner of the screen.
    expect(first).toMatchObject({ kind: "area", rect: { x: 0, y: 0, width: 1280, height: 720 } });
  });

  test("R centres the area on the pointer when there is room", async ({ page }) => {
    await open(page, "area", "last=400x300");
    await page.mouse.move(720, 450);
    await page.keyboard.press("r");
    const [first] = await submissions(page);
    expect(first?.rect).toEqual({ x: 520, y: 300, width: 400, height: 300 });
  });

  test("the bar's Repeat last button takes it too; without a remembered area there is none", async ({
    page,
  }) => {
    await open(page, "allinone", "last=400x300");
    await page.getByRole("button", { name: /Repeat last/ }).click();
    expect((await submissions(page))[0]).toMatchObject({ kind: "area" });

    await page.goto("/?window=overlay&session=mock&display=1&mode=allinone&toolbar=1");
    await expect(page.getByRole("button", { name: /Repeat last/ })).toHaveCount(0);
    await page.mouse.move(40, 40);
    await expect(page.getByTestId("repeat-outline")).toHaveCount(0);
    await page.keyboard.press("r");
    expect(await submissions(page)).toEqual([]);
  });
});

test.describe("text capture overlay (browser mock)", () => {
  test("Text is picked with T, says what it does, and a drag shows 'Text · size'", async ({
    page,
  }) => {
    await open(page, "area");
    await page.keyboard.press("t");
    await expect(page.getByRole("button", { name: "Text" })).toHaveAttribute(
      "aria-pressed",
      "true",
    );
    await expect(page.getByText("Select text")).toBeVisible();
    expect((await submissions(page)).at(-1)).toMatchObject({ kind: "mode", mode: "text" });
    await page.mouse.move(200, 150);
    await page.mouse.down();
    await page.mouse.move(760, 480, { steps: 6 });
    await expect(page.getByTestId("selection-label")).toHaveText("Text · 560 × 330");
    await page.screenshot({
      path: "test-results/text-capture-overlay.png",
      animations: "disabled",
    });
    await page.mouse.up();
    expect((await submissions(page)).at(-1)).toMatchObject({
      kind: "area",
      rect: { x: 200, y: 150, width: 560, height: 330 },
    });
  });

  test("in Text mode a click on a window takes nothing: it is about text", async ({ page }) => {
    await open(page, "text");
    await page.mouse.move(700, 450);
    await page.mouse.down();
    await page.mouse.up();
    expect(await submissions(page)).toEqual([]);
  });

  test("the tooltip of Text says no picture is kept", async ({ page }) => {
    await open(page, "area");
    await expect(page.getByRole("button", { name: "Text" })).toHaveAttribute(
      "title",
      /No picture is kept/,
    );
  });
});
