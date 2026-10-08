import { expect, test } from "@playwright/test";

test.use({ viewport: { width: 760, height: 780 } });

test("design system gallery renders in light and dark", async ({ page }) => {
  await page.goto("/?window=design");
  await expect(page.getByRole("button", { name: "Button" }).first()).toBeVisible();
  await expect(page.getByRole("switch", { name: "On" })).toHaveAttribute("aria-checked", "true");
  await page.screenshot({ path: "test-results/design-system-light.png", animations: "disabled" });
  await page.emulateMedia({ colorScheme: "dark" });
  await page.screenshot({ path: "test-results/design-system-dark.png", animations: "disabled" });
});
