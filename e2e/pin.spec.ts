import { expect, test, type Page } from "@playwright/test";

const submissions = (page: Page) => page.evaluate(() => window.__lumengrabMock?.submissions ?? []);
/** The window renders after its state arrived: wait for it before the pointer moves, or the hover is missed. */
async function openPin(page: Page, query = "") {
  await page.goto(`/?window=pin${query}`);
  await expect(page.getByRole("application")).toBeVisible();
}
const kinds = async (page: Page) => (await submissions(page)).map((s) => s.kind);

test.describe("pin window (browser mock)", () => {
  test.use({ viewport: { width: 480, height: 320 } });

  test("shows only the picture; the bar appears when the pointer is over it", async ({ page }) => {
    await openPin(page);
    await expect(page.getByRole("img", { name: "Screenshot_2026-10-25.png" })).toBeVisible();
    await expect(page.getByRole("toolbar", { name: "Pin" })).toHaveCount(0);
    await page.screenshot({ path: "test-results/pin-normal-light.png", animations: "disabled" });
    await page.mouse.move(200, 160);
    await expect(page.getByRole("toolbar", { name: "Pin" })).toBeVisible();
    await page.screenshot({ path: "test-results/pin-hover-light.png", animations: "disabled" });
  });

  test("the wheel steps the size and the window says so; reset goes back to 100%", async ({
    page,
  }) => {
    await openPin(page);
    await page.mouse.move(200, 160);
    await page.mouse.wheel(0, -100);
    await expect(page.getByText("110%").first()).toBeVisible();
    await page.mouse.wheel(0, 100);
    await page.mouse.wheel(0, 100);
    await expect(page.getByText("90%").first()).toBeVisible();
    await page.getByRole("application").press("0");
    await expect(page.getByText("100%").first()).toBeVisible();
    expect((await kinds(page)).filter((k) => k === "pinZoom")).toHaveLength(3);
    expect(await kinds(page)).toContain("pinResetSize");
  });

  test("opacity: the slider and the native menu both change it", async ({ page }) => {
    await openPin(page);
    await page.mouse.move(200, 160);
    await page.getByRole("button", { name: "Opacity" }).click();
    await page.getByRole("slider", { name: "Opacity" }).fill("70");
    await expect(page.getByRole("button", { name: "Opacity" })).toContainText("70%");
    await page.screenshot({ path: "test-results/pin-opacity-light.png", animations: "disabled" });
    await page.evaluate(() => window.__lumengrabMock?.chooseOpacity?.(40));
    await expect(page.getByRole("status")).toContainText("Opacity 40%");
    await expect(page.getByRole("img", { name: "Screenshot_2026-10-25.png" })).toHaveCSS(
      "opacity",
      "0.4",
    );
  });

  test("locked: no bar, a lock mark, and the way to unlock is said", async ({ page }) => {
    await openPin(page);
    await page.mouse.move(200, 160);
    await page.getByRole("button", { name: "Lock (click-through)" }).click();
    await expect(page.getByRole("img", { name: "Locked" })).toBeVisible();
    await expect(page.getByRole("status")).toContainText("Clicks go through");
    await expect(page.getByRole("status")).toContainText("tray menu");
    await expect(page.getByRole("toolbar", { name: "Pin" })).toHaveCount(0);
    await page.screenshot({ path: "test-results/pin-locked-light.png", animations: "disabled" });
    expect(await kinds(page)).toContain("pinLock");
  });

  test("copy, edit, close and the right-click menu go to the native side", async ({ page }) => {
    await openPin(page);
    await page.mouse.move(200, 160);
    await page.getByRole("button", { name: "Copy image" }).click();
    await expect(page.getByRole("status")).toContainText("Copied");
    await page.getByRole("button", { name: "Edit" }).click();
    await page.getByRole("application").click({ button: "right" });
    await page.getByRole("application").press("Escape");
    expect((await kinds(page)).filter((k) => k.startsWith("pin"))).toEqual([
      "pinCopy",
      "pinEdit",
      "pinMenu",
      "pinClose",
    ]);
  });

  test("dragging the picture starts moving the window", async ({ page }) => {
    await openPin(page);
    await page.mouse.move(200, 200);
    await page.mouse.down();
    await page.mouse.up();
    expect(await kinds(page)).toContain("pinDrag");
  });
});

test.describe("pinning from other windows (browser mock)", () => {
  test.use({ viewport: { width: 1100, height: 720 } });

  test("History: the hover button, the menu and the selection bar pin by id", async ({ page }) => {
    await page.goto("/?window=history");
    const first = page.getByTestId("history-card").first();
    await first.hover();
    await first.getByRole("button", { name: "Pin" }).click();
    await first.getByRole("button", { name: "More" }).click();
    await page.getByRole("menuitem", { name: /^Pin/ }).click();
    await page.getByRole("button", { name: "Select", exact: true }).click();
    const cards = page.getByTestId("history-card");
    for (const i of [0, 1])
      await cards
        .nth(i)
        .getByRole("button", { name: /^Select / })
        .click();
    await page.getByRole("button", { name: "Pin", exact: true }).click();
    const pins = (await submissions(page)).filter((s) => s.kind === "pinHistory");
    expect(pins.map((s) => s.id)).toEqual(["mock-1", "mock-1", "mock-1", "mock-2"]);
  });
});

test.describe("quick access card (browser mock)", () => {
  test.use({ viewport: { width: 500, height: 240 } });

  test("Pin on the compact card toggles: pinned (active) and unpinned again", async ({ page }) => {
    await page.goto("/?window=quick&card=compact&secs=0");
    const pin = page.getByRole("button", { name: "Pin to screen" });
    await expect(pin).toBeVisible();
    await pin.click();
    const pinned = page.getByRole("button", { name: "Unpin" });
    await expect(pinned).toHaveAttribute("aria-pressed", "true");
    await page.screenshot({ path: "test-results/qa-pinned-light.png", animations: "disabled" });
    await pinned.click();
    await expect(page.getByRole("button", { name: "Pin to screen" })).toBeVisible();
    expect((await kinds(page)).filter((k) => k === "pinQuickAccess")).toHaveLength(2);
  });

  test("the large card has the pin as a chip over the picture", async ({ page }) => {
    await page.setViewportSize({ width: 500, height: 420 });
    await page.goto("/?window=quick&card=large&secs=0");
    await page.getByRole("button", { name: "Pin to screen" }).click();
    await expect(page.getByRole("button", { name: "Unpin" })).toBeVisible();
    await page.screenshot({
      path: "test-results/qa-large-pinned-light.png",
      animations: "disabled",
    });
  });
});

test.describe("copy text on the quick access card (browser mock)", () => {
  test.use({ viewport: { width: 500, height: 320 } });

  const copiedText = (page: Page) => page.evaluate(() => window.__lumengrabMock?.copiedText);

  test("reads the picture, copies the text and says how many words", async ({ page }) => {
    await page.goto("/?window=quick&card=compact&secs=0");
    await page.getByRole("button", { name: "Copy text" }).click();
    await expect(page.getByText(/Text copied · \d+ words/)).toBeVisible();
    await expect(page.getByText("Paste it anywhere")).toBeVisible();
    expect(await copiedText(page)).toContain("anna.schmidt@example.com");
    await page.screenshot({
      path: "test-results/qa-text-copied-light.png",
      animations: "disabled",
    });
  });

  test("a picture without text says so and copies nothing", async ({ page }) => {
    await page.goto("/?window=quick&card=compact&secs=0&ocr=empty");
    await page.getByRole("button", { name: "Copy text" }).click();
    await expect(page.getByText("No text found")).toBeVisible();
    expect(await copiedText(page)).toBeUndefined();
  });

  test("an error offers Retry; a missing language pack offers the Windows settings", async ({
    page,
  }) => {
    await page.goto("/?window=quick&card=compact&secs=0&ocr=fail");
    await page.getByRole("button", { name: "Copy text" }).click();
    await expect(page.getByText("Could not read the text")).toBeVisible();
    await expect(page.getByRole("button", { name: "Retry" })).toBeVisible();

    await page.goto("/?window=quick&card=compact&secs=0&ocr=nolang");
    await page.getByRole("button", { name: "Copy text" }).click();
    await expect(page.getByText("No language pack for text recognition")).toBeVisible();
    await page.getByRole("button", { name: "Open language settings" }).click();
    expect((await submissions(page)).map((s) => s.kind)).toContain("openLanguageSettings");
  });

  test("a QR code with a link is offered first: Copy it, or Open it (the app asks)", async ({
    page,
  }) => {
    await page.goto("/?window=quick&card=compact&secs=0&ocr=qr");
    await page.getByRole("button", { name: "Copy text" }).click();
    await expect(page.getByText("Link found")).toBeVisible();
    await expect(page.getByText("lumengrab.app/docs/getting-started")).toBeVisible();
    await page.screenshot({ path: "test-results/qa-link-light.png", animations: "disabled" });
    await page.getByRole("button", { name: "Open" }).click();
    await page.getByRole("button", { name: "Copy", exact: true }).click();
    const log = await submissions(page);
    expect(log.find((s) => s.kind === "openLink")?.url).toBe(
      "https://lumengrab.app/docs/getting-started?ref=qr#install",
    );
    expect(await copiedText(page)).toBe(
      "https://lumengrab.app/docs/getting-started?ref=qr#install",
    );
  });

  test("the large card has the text button as a chip over the picture", async ({ page }) => {
    await page.setViewportSize({ width: 500, height: 440 });
    await page.goto("/?window=quick&card=large&secs=0");
    await page.getByRole("button", { name: "Copy text" }).click();
    await expect(page.getByText(/Text copied/)).toBeVisible();
    await page.screenshot({ path: "test-results/qa-large-text-light.png", animations: "disabled" });
  });
});
