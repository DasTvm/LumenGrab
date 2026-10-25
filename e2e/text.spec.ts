import { expect, test, type Page } from "@playwright/test";

test.use({ viewport: { width: 1280, height: 880 } });

const open = (page: Page, query = "") =>
  page.goto(`/?window=document&label=doc-1&scenario=stack${query}`);
const submissions = (page: Page) => page.evaluate(() => window.__lumengrabMock?.submissions ?? []);
const kinds = async (page: Page) => (await submissions(page)).map((s) => s.kind);
const copied = (page: Page) => page.evaluate(() => window.__lumengrabMock?.copiedText);

test.describe("reading text in the editor (browser mock)", () => {
  test("Copy text opens the panel, reads, shows the blocks and copies everything", async ({
    page,
  }) => {
    await open(page);
    await page.getByRole("button", { name: "Copy text" }).click();
    await expect(page.getByTestId("text-panel")).toBeVisible();
    await expect(page.getByTestId("text-block")).toHaveCount(6);
    await expect(page.getByText("6 blocks · read on this device")).toBeVisible();
    await expect(
      page.getByText("Reads the image as exported. Redacted text is not read."),
    ).toBeVisible();
    await expect(page.getByTestId("toasts")).toContainText(/Text copied · \d+ words/);
    expect(await copied(page)).toContain("anna.schmidt@example.com");
    expect((await kinds(page)).filter((k) => k === "recognize")).toHaveLength(1);
    await expect(page.getByTestId("text-box")).toHaveCount(6);
    await page.screenshot({ path: "test-results/text-result-light.png", animations: "disabled" });
    await page.emulateMedia({ colorScheme: "dark" });
    await page.screenshot({ path: "test-results/text-result-dark.png", animations: "disabled" });
  });

  test("it shows that it is reading while it reads", async ({ page }) => {
    await open(page, "&ocr=slow");
    await page.getByRole("button", { name: "Copy text" }).click();
    await expect(page.getByRole("status").filter({ hasText: "Reading…" })).toBeVisible();
    await page.screenshot({ path: "test-results/text-reading-light.png", animations: "disabled" });
    await expect(page.getByTestId("text-block")).toHaveCount(6, { timeout: 10_000 });
  });

  test("picking blocks, in the list or on the picture, copies only those", async ({ page }) => {
    await open(page);
    await page.getByRole("button", { name: "Copy text" }).click();
    await expect(page.getByTestId("text-block")).toHaveCount(6);
    await page.getByTestId("text-block").nth(1).click();
    await page.getByTestId("text-box").nth(5).dispatchEvent("click");
    await expect(page.getByText("2 of 6 selected")).toBeVisible();
    await page.screenshot({ path: "test-results/text-selected-light.png", animations: "disabled" });
    await page.getByRole("button", { name: "Copy selection (2)" }).click();
    await expect(page.getByTestId("toasts")).toContainText("Text copied · 3 words");
    expect(await copied(page)).toBe("anna.schmidt@example.com\nTotal $48.00");
    await page.getByTestId("text-block").nth(1).click();
    await expect(page.getByText("1 of 6 selected")).toBeVisible();
  });

  test("Esc, the X and the shortcut close and open the panel", async ({ page }) => {
    await open(page);
    await expect(page.getByRole("button", { name: "Copy text" })).toBeVisible();
    await page.keyboard.press("ControlOrMeta+Shift+t");
    await expect(page.getByTestId("text-panel")).toBeVisible();
    await page.keyboard.press("Escape");
    await expect(page.getByTestId("text-panel")).toHaveCount(0);
    await page.getByRole("button", { name: "Copy text" }).click();
    await page.getByRole("button", { name: "Close text panel" }).click();
    await expect(page.getByTestId("text-panel")).toHaveCount(0);
  });

  test("no text: says so and can read again", async ({ page }) => {
    await open(page, "&ocr=empty");
    await page.getByRole("button", { name: "Copy text" }).click();
    await expect(page.getByText("No text found")).toBeVisible();
    await expect(page.getByText("Try a larger area or a sharper picture")).toBeVisible();
    await page.screenshot({ path: "test-results/text-empty-light.png", animations: "disabled" });
    await page.getByRole("button", { name: "Read again" }).click();
    await expect
      .poll(async () => (await kinds(page)).filter((k) => k === "recognize").length)
      .toBe(2);
  });

  test("an error says nothing was copied and offers to try again", async ({ page }) => {
    await open(page, "&ocr=fail");
    await page.getByRole("button", { name: "Copy text" }).click();
    await expect(page.getByText("Could not read the text")).toBeVisible();
    await expect(page.getByText("Nothing was copied. Your picture is not changed.")).toBeVisible();
    expect(await copied(page)).toBeUndefined();
    await page.getByRole("button", { name: "Try again" }).click();
  });

  test("without a language pack (Windows) it says how to get one", async ({ page }) => {
    await open(page, "&ocr=nolang");
    await page.getByRole("button", { name: "Copy text" }).click();
    await expect(page.getByText("No language pack for text recognition")).toBeVisible();
    await page.screenshot({ path: "test-results/text-nolang-light.png", animations: "disabled" });
    await page.getByRole("button", { name: "Open language settings" }).click();
    expect(await kinds(page)).toContain("openLanguageSettings");
  });

  test("a QR code with a link: copy it, or open it only after the address was shown", async ({
    page,
  }) => {
    await open(page, "&ocr=qr");
    await page.getByRole("button", { name: "Copy text" }).click();
    const code = page.getByTestId("text-code");
    await expect(code).toContainText("https://lumengrab.app/docs/getting-started?ref=qr#install");
    await expect(page.getByTestId("code-box")).toHaveCount(1);
    await expect(page.getByText("1 code · 6 text blocks")).toBeVisible();
    await page.screenshot({ path: "test-results/text-qr-light.png", animations: "disabled" });
    await code.getByRole("button", { name: "Open link" }).click();
    const dialog = page.getByRole("dialog", { name: "Open this link?" });
    await expect(dialog.getByTestId("link-address")).toHaveText(
      "https://lumengrab.app/docs/getting-started?ref=qr#install",
    );
    await expect(dialog.getByTestId("link-address").locator("strong")).toHaveText("lumengrab.app");
    await page.screenshot({
      path: "test-results/text-link-dialog-light.png",
      animations: "disabled",
    });
    expect(await kinds(page)).not.toContain("openLink");
    await dialog.getByRole("button", { name: "Open" }).click();
    expect((await submissions(page)).find((s) => s.kind === "openLink")?.url).toBe(
      "https://lumengrab.app/docs/getting-started?ref=qr#install",
    );
  });

  test("cancelling the link question opens nothing", async ({ page }) => {
    await open(page, "&ocr=qr");
    await page.getByRole("button", { name: "Copy text" }).click();
    await page.getByRole("button", { name: "Open link" }).click();
    await page.getByRole("dialog").getByRole("button", { name: "Cancel" }).click();
    await expect(page.getByRole("dialog")).toHaveCount(0);
    expect(await kinds(page)).not.toContain("openLink");
  });

  test("a code without text still shows; a code that is no web address has no Open", async ({
    page,
  }) => {
    await open(page, "&ocr=qr-only");
    await page.getByRole("button", { name: "Copy text" }).click();
    await expect(page.getByText("1 code · no text")).toBeVisible();
    await expect(page.getByText("No other text found")).toBeVisible();
    await expect(page.getByRole("button", { name: "Copy all" })).toHaveCount(0);

    await page.getByRole("button", { name: "Close text panel" }).click();
    await page.goto(`/?window=document&label=doc-1&scenario=stack&ocr=qr-two`);
    await page.getByRole("button", { name: "Copy text" }).click();
    await expect(page.getByTestId("text-code")).toHaveCount(2);
    await expect(page.getByTestId("text-code").nth(1)).toContainText("WIFI:T:WPA");
    await expect(
      page.getByTestId("text-code").nth(1).getByRole("button", { name: "Open link" }),
    ).toHaveCount(0);
    await page.screenshot({ path: "test-results/text-qr-two-light.png", animations: "disabled" });
    await page.getByRole("button", { name: "Copy QR code 2" }).click();
    expect(await copied(page)).toBe("WIFI:T:WPA;S:Office;P:secret;;");
  });
});
