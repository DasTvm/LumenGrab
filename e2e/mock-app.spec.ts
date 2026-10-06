import { expect, test } from "@playwright/test";

test("mock app: empty state, fake capture, screenshots in light and dark", async ({ page }) => {
  await page.goto("/");
  await expect(page.getByTestId("runtime")).toContainText("browser-mock");
  await expect(page.getByText("No capture yet")).toBeVisible();
  await page.screenshot({ path: "test-results/mock-empty-light.png", animations: "disabled" });

  await page.getByRole("button", { name: "Capture" }).click();
  const image = page.getByRole("img", { name: "Captured screen" });
  await expect(image).toBeVisible();
  await page.screenshot({ path: "test-results/mock-capture-light.png", animations: "disabled" });

  await page.emulateMedia({ colorScheme: "dark" });
  await page.screenshot({ path: "test-results/mock-capture-dark.png", animations: "disabled" });
});

test("settings placeholder window renders", async ({ page }) => {
  await page.goto("/?window=settings");
  await expect(page.getByRole("heading", { name: "Settings" })).toBeVisible();
});
