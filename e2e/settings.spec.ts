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

  test("default capture mode: All-in-one first, the choice is sent to the native side and kept", async ({
    page,
  }) => {
    await page.goto("/?window=settings");
    const all = page.getByRole("radio", { name: "All-in-one" });
    const window_ = page.getByRole("radio", { name: "Window" });
    await expect(all).toHaveAttribute("aria-checked", "true");
    await expect(page.getByRole("radio", { name: "Area" })).toHaveAttribute(
      "aria-checked",
      "false",
    );
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
      defaultMode: "allinone",
      copyToClipboard: false,
      quickAccess: { enabled: true, style: "large", autoCloseSecs: 10, corner: "topLeft" },
      presentation: { auto: false, openInPresentation: false },
      updates: { auto: true },
      history: { enabled: true, keep: "month", textPicture: false, filters: "sidebar" },
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

  test("Presentation page: pick the default look, switch the automatic look on, choose the editor mode and the aspect ratio", async ({
    page,
  }) => {
    await page.goto("/?window=settings");
    await page.getByRole("button", { name: "Presentation" }).click();
    await expect(page.getByRole("heading", { name: "Presentation", level: 1 })).toBeVisible();
    await expect(page.getByTestId("default-preview")).toBeVisible();
    // Midnight is the default until the user picks another look.
    await expect(page.getByRole("button", { name: "Midnight", exact: true })).toHaveAttribute(
      "aria-pressed",
      "true",
    );
    await page.getByRole("button", { name: "Sunset", exact: true }).click();
    await expect(page.getByRole("button", { name: "Sunset", exact: true })).toHaveAttribute(
      "aria-pressed",
      "true",
    );
    type Stored = { defaultLook: { name: string; parts: { aspect?: { size?: number[] } } } };
    const stored = () =>
      page.evaluate(
        () => JSON.parse(window.localStorage.getItem("lumengrab.mock.looks") ?? "{}") as Stored,
      );
    expect((await stored()).defaultLook.name).toBe("Sunset");

    const auto = page.getByRole("switch", { name: "Apply the default look automatically" });
    await expect(auto).toHaveAttribute("aria-checked", "false");
    await auto.click();
    await page.getByRole("radio", { name: "Presentation" }).click();
    await page.getByLabel("Default aspect ratio").selectOption("instagram-story");
    await expect
      .poll(async () => (await stored()).defaultLook.parts.aspect?.size)
      .toEqual([1080, 1920]);
    await page.getByLabel("Default aspect ratio").selectOption("auto");
    await expect.poll(async () => (await stored()).defaultLook.parts.aspect).toBeUndefined();

    const log = await submissions(page);
    expect(log.filter((e) => e.kind === "settings").at(-1)?.settings?.presentation).toEqual({
      auto: true,
      openInPresentation: true,
    });
    await page.screenshot({
      path: "test-results/settings-presentation-light.png",
      animations: "disabled",
    });
  });

  test("Presentation page: my looks can be renamed and deleted, and an empty list explains itself", async ({
    page,
  }) => {
    await page.goto("/?window=settings");
    await page.getByRole("button", { name: "Presentation" }).click();
    await expect(page.getByText("You have not saved a look yet")).toBeVisible();
    await page.evaluate(() => {
      window.localStorage.setItem(
        "lumengrab.mock.looks",
        JSON.stringify({
          version: 1,
          looks: [{ id: "a", name: "Client demo", parts: { cornerRadius: 20 } }],
          defaultLook: null,
        }),
      );
    });
    await page.reload();
    await page.getByRole("button", { name: "Presentation" }).click();
    await page.getByRole("button", { name: "Rename Client demo" }).click();
    const input = page.getByLabel("Look name");
    await input.fill("Docs");
    await input.press("Enter");
    await expect(page.getByRole("button", { name: "Delete Docs" })).toBeVisible();
    await page.getByRole("button", { name: "Delete Docs" }).click();
    await page.getByRole("dialog").getByRole("button", { name: "Delete" }).click();
    await expect(page.getByText("You have not saved a look yet")).toBeVisible();
  });

  test.describe("Updates page", () => {
    const open = async (page: Page, query = "") => {
      await page.goto(`/?window=settings${query}`);
      await page.getByRole("button", { name: "Updates" }).click();
      await expect(page.getByRole("heading", { name: "Updates", level: 1 })).toBeVisible();
    };

    test("the app can open this page, from the address or while Settings is open", async ({
      page,
    }) => {
      await page.goto("/?window=settings&page=updates");
      await expect(page.getByRole("heading", { name: "Updates", level: 1 })).toBeVisible();
      await page.goto("/?window=settings");
      await expect(page.getByRole("heading", { name: "General", level: 1 })).toBeVisible();
      await page.evaluate(() => {
        window.__lumengrabMock?.settingsPage?.("updates");
      });
      await expect(page.getByRole("heading", { name: "Updates", level: 1 })).toBeVisible();
    });

    test("a check that finds nothing says so and remembers when", async ({ page }) => {
      await open(page);
      await expect(page.getByText("Not checked yet")).toBeVisible();
      await page.getByRole("button", { name: "Check now" }).click();
      await expect(page.getByText("Checking for updates…")).toBeVisible();
      await expect(page.getByText("You're up to date")).toBeVisible();
      await expect(page.getByText("LumenGrab 0.4.2 is the latest version.")).toBeVisible();
      await expect(page.getByText(/Last checked: today, \d\d:\d\d/)).toBeVisible();
      await page.screenshot({
        path: "test-results/settings-updates-uptodate.png",
        animations: "disabled",
      });
    });

    test("an update: the notes by group, install = download, then restart", async ({ page }) => {
      await open(page, "&check=available");
      await page.getByRole("button", { name: "Check now" }).click();
      await expect(page.getByText("Version 0.5.0 is available")).toBeVisible();
      await expect(page.getByText("Released Oct 12, 2026")).toBeVisible();
      const notes = page.getByLabel("What's new in 0.5.0");
      await expect(notes).toContainText(
        "Presentation mode with looks, backgrounds and window frames",
      );
      await expect(notes.getByText("Fixed", { exact: true })).toBeVisible();
      await page.screenshot({
        path: "test-results/settings-updates-available.png",
        animations: "disabled",
      });

      await page.getByRole("button", { name: "Install and restart" }).click();
      await expect(page.getByText("Downloading version 0.5.0")).toBeVisible();
      await expect(page.getByRole("progressbar")).toBeVisible();
      await expect(page.getByText("Version 0.5.0 is ready")).toBeVisible({ timeout: 8000 });
      await page.getByRole("button", { name: "Restart now" }).click();
      expect((await submissions(page)).some((e) => e.kind === "updateRestart")).toBe(true);
    });

    test("a running download can be cancelled, an update can be skipped, the release page opens", async ({
      page,
    }) => {
      await open(page, "&update=downloading");
      await expect(page.getByText("24 of 38 MB")).toBeVisible();
      await page.getByRole("button", { name: "Cancel" }).click();
      await expect(page.getByText("Version 0.5.0 is available")).toBeVisible();
      await page.getByRole("button", { name: "See what's new" }).click();
      expect((await submissions(page)).find((e) => e.kind === "openUrl")?.url).toBe(
        "https://github.com/DasTvm/LumenGrab/releases/tag/v0.5.0",
      );
      await page.getByRole("button", { name: "Skip this version" }).click();
      await expect(page.getByText("You're up to date")).toBeVisible();
    });

    test("the states of a ready update and of every failure", async ({ page }) => {
      await open(page, "&update=ready");
      await expect(page.getByText("Version 0.5.0 is ready")).toBeVisible();
      await page.getByRole("button", { name: "Later" }).click();
      await expect(page.getByText("The update installs when you restart LumenGrab.")).toBeVisible();

      for (const [scenario, title] of [
        ["failed-network", "Could not check for updates"],
        ["failed-signature", "Update failed: security check"],
        ["failed-disk", "Update failed: not enough space"],
      ] as const) {
        await open(page, `&update=${scenario}`);
        await expect(page.getByText(title)).toBeVisible();
        await expect(page.getByRole("button", { name: "Try again" })).toBeVisible();
        await expect(page.getByText(/^Details:/)).toBeVisible();
      }
      await page.screenshot({
        path: "test-results/settings-updates-failed.png",
        animations: "disabled",
      });
    });

    test("the daily check can be turned off, and the page says what goes online", async ({
      page,
    }) => {
      await open(page);
      const auto = page.getByRole("switch", { name: "Check for updates automatically" });
      await expect(auto).toHaveAttribute("aria-checked", "true");
      await expect(
        page.getByText("The update check is the only network access LumenGrab has."),
      ).toBeVisible();
      await auto.click();
      const saved = (await submissions(page)).filter((e) => e.kind === "settings").at(-1);
      expect(saved?.settings?.updates).toEqual({ auto: false });
    });

    test("a build without the update key hides the controls instead of failing", async ({
      page,
    }) => {
      await open(page, "&update=unavailable");
      await expect(page.getByText("Updates are not set up in this build.")).toBeVisible();
      await expect(page.getByRole("button", { name: "Check now" })).toHaveCount(0);
      await expect(
        page.getByRole("switch", { name: "Check for updates automatically" }),
      ).toHaveCount(0);
    });
  });
});
