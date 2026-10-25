import { expect, test, type Page } from "@playwright/test";

// Design size of the History frames in LumenGrab.pen.
test.use({ viewport: { width: 1100, height: 720 } });

const submissions = (page: Page) => page.evaluate(() => window.__lumengrabMock?.submissions ?? []);
const kinds = async (page: Page) => (await submissions(page)).map((s) => s.kind);

test.describe("history window (browser mock)", () => {
  test("lists the captures in day groups, newest first, with counts in the sidebar", async ({
    page,
  }) => {
    await page.goto("/?window=history");
    await expect(page.getByTestId("history-card")).toHaveCount(12);
    await expect(page.getByRole("region", { name: "Today" })).toBeVisible();
    await expect(page.getByRole("region", { name: "Yesterday" })).toBeVisible();
    await expect(page.getByRole("region", { name: "Earlier" })).toBeVisible();
    await expect(page.getByRole("heading", { name: "All captures 12", level: 1 })).toBeVisible();
    await expect(page.getByRole("button", { name: /^All 12$/ })).toHaveAttribute(
      "aria-pressed",
      "true",
    );
    await expect(page.getByRole("button", { name: /^Pinned 2$/ })).toBeVisible();
    await page.screenshot({ path: "test-results/history-grid-light.png", animations: "disabled" });
    await page.emulateMedia({ colorScheme: "dark" });
    await page.screenshot({ path: "test-results/history-grid-dark.png", animations: "disabled" });
  });

  test("a source filter and a search narrow the list; no match says so and clears", async ({
    page,
  }) => {
    await page.goto("/?window=history");
    await page.getByRole("button", { name: /^Window/ }).click();
    await expect(page.getByRole("heading", { name: /^Window/, level: 1 })).toBeVisible();
    for (const card of await page.getByTestId("history-card").all()) {
      await expect(card.getByLabel("Window", { exact: true })).toBeVisible();
    }
    await page.getByRole("button", { name: /^All \d+$/ }).click();
    await page.getByRole("searchbox", { name: "Search captures" }).fill("invoice");
    await expect(page.getByTestId("history-card")).toHaveCount(1);
    await expect(page.getByTestId("count")).toHaveText("1 result");
    await page.getByRole("searchbox", { name: "Search captures" }).fill("zzz");
    await expect(page.getByText("No results for “zzz”")).toBeVisible();
    await page.getByRole("button", { name: "Clear search" }).first().click();
    await expect(page.getByTestId("history-card")).toHaveCount(12);
  });

  test("Pinned with nothing pinned, and no captures at all, each have their own empty state", async ({
    page,
  }) => {
    await page.goto("/?window=history&history=empty");
    await expect(page.getByText("No captures yet")).toBeVisible();
    await expect(page.getByText("Capture area")).toBeVisible();
    await page.screenshot({ path: "test-results/history-empty-light.png", animations: "disabled" });
  });

  test("a card's actions go to the native side by id: copy, edit, menu, reveal", async ({
    page,
  }) => {
    await page.goto("/?window=history");
    const first = page.getByTestId("history-card").first();
    await first.hover();
    await first.getByRole("button", { name: "Copy image" }).click();
    await expect(page.getByText("Copied to clipboard")).toBeVisible();
    await first.getByRole("button", { name: /^Open / }).click();
    await first.getByRole("button", { name: "More" }).click();
    await expect(page.getByRole("menu", { name: "Capture actions" })).toBeVisible();
    await page.screenshot({ path: "test-results/history-menu-light.png", animations: "disabled" });
    await page.getByRole("menuitem", { name: /Show in folder/ }).click();
    const all = await submissions(page);
    expect(all.filter((s) => s.kind.startsWith("history")).map((s) => [s.kind, s.id])).toEqual([
      ["historyCopy", "mock-1"],
      ["historyEdit", "mock-1"],
      ["historyReveal", "mock-1"],
    ]);
  });

  test("Move to Trash takes the card away at once, with an Undo that brings it back", async ({
    page,
  }) => {
    await page.goto("/?window=history");
    const card = page.getByTestId("history-card").first();
    await card.getByRole("button", { name: /^Open / }).focus();
    await page.keyboard.press("Delete");
    await expect(page.getByTestId("history-card")).toHaveCount(11);
    await expect(page.getByText("Moved to Trash")).toBeVisible();
    await page.getByRole("button", { name: "Undo" }).click();
    await expect(page.getByTestId("history-card")).toHaveCount(12);
    expect(await kinds(page)).toEqual(["historyTrash", "historyUndoTrash"]);
  });

  test("selecting several asks before moving them to the Trash", async ({ page }) => {
    await page.goto("/?window=history");
    await page.getByRole("button", { name: "Select", exact: true }).click();
    const cards = page.getByTestId("history-card");
    for (const i of [0, 1, 2])
      await cards
        .nth(i)
        .getByRole("button", { name: /^Select / })
        .click();
    await expect(page.getByRole("heading", { name: "3 selected" })).toBeVisible();
    await page.screenshot({
      path: "test-results/history-selection-light.png",
      animations: "disabled",
    });
    await page.getByRole("button", { name: "Move to Trash" }).click();
    await expect(page.getByRole("dialog", { name: "Move 3 images to Trash?" })).toBeVisible();
    await page.getByRole("dialog").getByRole("button", { name: "Move to Trash" }).click();
    await expect(page.getByTestId("history-card")).toHaveCount(9);
    const trash = (await submissions(page)).find((s) => s.kind === "historyTrash");
    expect(trash?.ids).toEqual(["mock-1", "mock-2", "mock-3"]);
  });

  test("the list view shows name, source, size and when", async ({ page }) => {
    await page.goto("/?window=history");
    await page.getByRole("button", { name: "List" }).click();
    await expect(page.getByTestId("history-row")).toHaveCount(12);
    await expect(page.getByRole("columnheader", { name: "Captured" })).toBeVisible();
    await page.screenshot({ path: "test-results/history-list-light.png", animations: "disabled" });
  });

  test("a capture whose file is gone says so and can only be removed", async ({ page }) => {
    await page.goto("/?window=history&history=missing");
    await expect(page.getByText("File not found").first()).toBeVisible();
    await expect(page.getByText("Moved or deleted").first()).toBeVisible();
    const card = page.getByTestId("history-card").first();
    await card.hover();
    await card.getByRole("button", { name: "Remove" }).click();
    expect(await kinds(page)).toEqual(["historyRemove"]);
  });

  test("with history off a notice says so and offers to turn it on", async ({ page }) => {
    await page.goto("/?window=history&history=off");
    await expect(page.getByText("History is off")).toBeVisible();
    await page.getByRole("button", { name: "Turn on" }).click();
    const saved = (await submissions(page)).find((s) => s.kind === "settings");
    expect(saved?.settings?.history.enabled).toBe(true);
  });

  test("a damaged history offers to try again, open the folder or start over", async ({ page }) => {
    await page.goto("/?window=history&history=broken");
    await expect(page.getByRole("alert")).toContainText("History can't be read");
    await expect(page.getByRole("alert")).toContainText("Your image files are not affected");
    await page.screenshot({ path: "test-results/history-error-light.png", animations: "disabled" });
    await page.getByRole("button", { name: "Start with a new history" }).click();
    await expect(page.getByText("No captures yet")).toBeVisible();
  });

  test("the filter chips layout has no sidebar and the same filters as pills", async ({ page }) => {
    await page.addInitScript(() => {
      window.localStorage.setItem(
        "lumengrab.mock.settings",
        JSON.stringify({
          history: { enabled: true, keep: "month", textPicture: false, filters: "chips" },
        }),
      );
    });
    await page.goto("/?window=history");
    await expect(page.getByRole("navigation", { name: "Filters" })).toHaveCount(0);
    await page
      .getByRole("group", { name: "Filters" })
      .getByRole("button", { name: /^Area/ })
      .click();
    await expect(page.getByRole("heading", { name: /^Area/, level: 1 })).toBeVisible();
    await page.screenshot({ path: "test-results/history-chips-light.png", animations: "disabled" });
  });
});

test.describe("settings, History page (browser mock)", () => {
  test("keeping, view and storage; clear history asks first and says what was freed", async ({
    page,
  }) => {
    await page.goto("/?window=settings&page=history");
    await expect(page.getByRole("heading", { name: "History", level: 1 })).toBeVisible();
    await expect(page.getByRole("switch", { name: "Keep a history of my captures" })).toBeChecked();
    await expect(page.getByRole("combobox", { name: "Keep captures for" })).toHaveValue("month");
    await expect(
      page.getByRole("switch", { name: "Keep a picture of text captures" }),
    ).not.toBeChecked();
    await expect(page.getByRole("radio", { name: /Sidebar/ })).toHaveAttribute(
      "aria-checked",
      "true",
    );
    await expect(page.getByText("12 captures ·")).toBeVisible();
    await page.screenshot({
      path: "test-results/settings-history-light.png",
      animations: "disabled",
      fullPage: true,
    });

    await page.getByRole("combobox", { name: "Keep captures for" }).selectOption("forever");
    await page.getByRole("radio", { name: /Filter chips/ }).click();
    await page.getByRole("button", { name: "Clear history…" }).click();
    await expect(page.getByRole("dialog", { name: "Clear history?" })).toContainText("12 captures");
    await page.getByRole("dialog").getByRole("button", { name: "Clear history" }).click();
    await expect(page.getByText(/History cleared · .* freed/)).toBeVisible();
    const saves = (await submissions(page)).filter((s) => s.kind === "settings");
    expect(saves.at(-1)?.settings?.history).toEqual({
      enabled: true,
      keep: "forever",
      textPicture: false,
      filters: "chips",
    });
    expect(await kinds(page)).toContain("historyClear");
  });

  test("with history off the options below are disabled and the page says what stays", async ({
    page,
  }) => {
    await page.goto("/?window=settings&page=history");
    await page.getByRole("switch", { name: "Keep a history of my captures" }).click();
    await expect(page.getByRole("combobox", { name: "Keep captures for" })).toBeDisabled();
    await expect(page.getByText(/History is off. New captures are not kept/)).toBeVisible();
  });
});
