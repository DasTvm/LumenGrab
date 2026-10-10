import { expect, test, type Page } from "@playwright/test";

// Design size of the Settings frames in LumenGrab.pen.
test.use({ viewport: { width: 1100, height: 720 } });

const submissions = (page: Page) => page.evaluate(() => window.__lumengrabMock?.submissions ?? []);

test.describe("settings (browser mock)", () => {
  test("General page: sections, save location, unavailable options say Soon", async ({ page }) => {
    await page.goto("/?window=settings");
    await expect(page.getByRole("heading", { name: "General", level: 1 })).toBeVisible();
    await expect(page.getByRole("button", { name: "General" })).toHaveAttribute(
      "aria-current",
      "page",
    );
    await expect(page.getByTestId("save-dir")).toHaveText("~/Pictures/LumenGrab");

    // Options that are not built yet are visible but off and disabled, never faked.
    for (const name of ["Launch at login", "Play sound on capture"]) {
      const sw = page.getByRole("switch", { name });
      await expect(sw).toBeDisabled();
      await expect(sw).toHaveAttribute("aria-checked", "false");
    }
    await expect(page.getByText("Soon")).toHaveCount(2);
    await expect(
      page.getByRole("switch", { name: "Copy to clipboard automatically" }),
    ).toBeEnabled();
    await page.screenshot({
      path: "test-results/settings-general-light.png",
      animations: "disabled",
    });
  });

  test("default capture mode: Area first, the choice is sent to the native side and kept", async ({
    page,
  }) => {
    await page.goto("/?window=settings");
    const area = page.getByRole("radio", { name: "Area" });
    const window_ = page.getByRole("radio", { name: "Window" });
    await expect(area).toHaveAttribute("aria-checked", "true");
    await window_.click();
    await expect(window_).toHaveAttribute("aria-checked", "true");
    const [saved] = await submissions(page);
    expect(saved?.kind).toBe("settings");
    expect(saved?.settings?.defaultMode).toBe("window");
    await page.reload();
    await expect(page.getByRole("radio", { name: "Window" })).toHaveAttribute(
      "aria-checked",
      "true",
    );
    await page.screenshot({
      path: "test-results/settings-general-default-mode.png",
      animations: "disabled",
    });
  });

  test("After capture: Quick Access options are saved and survive a reload", async ({ page }) => {
    await page.goto("/?window=settings");
    const clipboard = page.getByRole("switch", { name: "Copy to clipboard automatically" });
    const quick = page.getByRole("switch", { name: "Show Quick Access" });
    await expect(clipboard).toHaveAttribute("aria-checked", "true");
    await expect(quick).toHaveAttribute("aria-checked", "true");
    // The design defaults: compact, 5 s, bottom right.
    await expect(page.getByRole("radio", { name: "Compact" })).toHaveAttribute(
      "aria-checked",
      "true",
    );
    await expect(page.getByRole("radio", { name: "5 s" })).toHaveAttribute("aria-checked", "true");
    await expect(page.getByRole("radio", { name: "Bottom right" })).toHaveAttribute(
      "aria-checked",
      "true",
    );

    await clipboard.click();
    await page.getByRole("radio", { name: "Large preview" }).click();
    await page.getByRole("radio", { name: "10 s" }).click();
    await page.getByRole("radio", { name: "Top left" }).click();

    const log = await submissions(page);
    expect(log.map((s) => s.kind)).toEqual(["settings", "settings", "settings", "settings"]);
    expect(log.at(-1)?.settings).toEqual({
      defaultMode: "area",
      copyToClipboard: false,
      quickAccess: { enabled: true, style: "large", autoCloseSecs: 10, corner: "topLeft" },
      seenIntro: false,
    });
    await page.screenshot({
      path: "test-results/settings-after-capture-light.png",
      animations: "disabled",
    });

    await page.reload();
    await expect(page.getByRole("radio", { name: "Large preview" })).toHaveAttribute(
      "aria-checked",
      "true",
    );
    await expect(page.getByRole("radio", { name: "10 s" })).toHaveAttribute("aria-checked", "true");
    await expect(page.getByRole("radio", { name: "Top left" })).toHaveAttribute(
      "aria-checked",
      "true",
    );
    await expect(clipboard).toHaveAttribute("aria-checked", "false");
  });

  test("turning Quick Access off disables its other options, auto-close can be Off", async ({
    page,
  }) => {
    await page.goto("/?window=settings");
    await page.getByRole("radio", { name: "Off" }).click();
    const log = await submissions(page);
    expect(log.at(-1)?.settings?.quickAccess.autoCloseSecs).toBe(0);

    await page.getByRole("switch", { name: "Show Quick Access" }).click();
    for (const name of ["Compact", "Large preview", "Off", "5 s", "10 s", "Top left"]) {
      await expect(page.getByRole("radio", { name })).toBeDisabled();
    }
  });

  test("the corner picker works with the arrow keys", async ({ page }) => {
    await page.goto("/?window=settings");
    await page.getByRole("radio", { name: "Bottom right" }).focus();
    await page.keyboard.press("ArrowLeft");
    await expect(page.getByRole("radio", { name: "Bottom left" })).toHaveAttribute(
      "aria-checked",
      "true",
    );
    await page.keyboard.press("ArrowUp");
    await expect(page.getByRole("radio", { name: "Top left" })).toHaveAttribute(
      "aria-checked",
      "true",
    );
    await expect(page.getByRole("radio", { name: "Top left" })).toBeFocused();
  });

  test("Open folder button asks the native side to open the screenshots folder", async ({
    page,
  }) => {
    await page.goto("/?window=settings");
    await page.getByRole("button", { name: "Open" }).click();
    expect(await submissions(page)).toEqual([{ kind: "openFolder" }]);
  });

  test("theme: choosing Dark forces dark, survives a reload, System follows the OS again", async ({
    page,
  }) => {
    await page.emulateMedia({ colorScheme: "light" });
    await page.goto("/?window=settings");
    const html = page.locator("html");
    await expect(html).not.toHaveAttribute("data-theme", /.+/);

    await page.getByRole("radio", { name: "Dark" }).click();
    await expect(html).toHaveAttribute("data-theme", "dark");
    await expect(page.locator("body")).toHaveCSS("background-color", "rgb(9, 9, 11)");
    await page.screenshot({
      path: "test-results/settings-general-dark.png",
      animations: "disabled",
    });

    await page.reload();
    await expect(html).toHaveAttribute("data-theme", "dark");
    await expect(page.getByRole("radio", { name: "Dark" })).toHaveAttribute("aria-checked", "true");

    await page.getByRole("radio", { name: "System" }).click();
    await expect(html).not.toHaveAttribute("data-theme", /.+/);
  });

  test("theme picker works with the keyboard (arrow keys)", async ({ page }) => {
    await page.goto("/?window=settings");
    await page.getByRole("radio", { name: "System" }).focus();
    await page.keyboard.press("ArrowRight");
    await expect(page.getByRole("radio", { name: "Light" })).toHaveAttribute(
      "aria-checked",
      "true",
    );
    await expect(page.locator("html")).toHaveAttribute("data-theme", "light");
  });

  test("Hotkeys page lists the real shortcuts", async ({ page }) => {
    await page.goto("/?window=settings");
    await page.getByRole("button", { name: "Hotkeys" }).click();
    await expect(page.getByRole("heading", { name: "Hotkeys", level: 1 })).toBeVisible();
    for (const [title, spoken] of [
      ["Capture", "Control Shift 1"],
      ["Capture Area", "Control Shift 4"],
      ["Capture Window", "Control Shift 5"],
      ["Capture Fullscreen", "Control Shift 3"],
    ] as const) {
      const row = page
        .getByRole("listitem")
        .filter({ has: page.getByText(title, { exact: true }) });
      await expect(row).toBeVisible();
      await expect(row.getByRole("img", { name: spoken })).toBeVisible();
    }
    await expect(page.getByText("In use by another app")).toHaveCount(0);
    await page.screenshot({
      path: "test-results/settings-hotkeys-light.png",
      animations: "disabled",
    });
  });
});
