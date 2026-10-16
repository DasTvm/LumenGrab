import { expect, test, type Page } from "@playwright/test";
import type { Presentation } from "../src/document/schema";

test.use({ viewport: { width: 1280, height: 880 } });

const open = async (page: Page) => {
  await page.goto("/?window=document&label=doc-1&scenario=stack");
  await expect(page.getByTestId("editor-canvas")).toBeVisible();
  await page.waitForFunction(() => window.__lumengrabEditor?.ui.getState().view != null);
  await page.getByRole("radio", { name: "Presentation" }).click();
  await expect(page.getByTestId("presentation-panel")).toBeVisible();
};
const presentation = (page: Page) =>
  page.evaluate(
    () => window.__lumengrabEditor?.editor.getState().project.presentation,
  ) as Promise<Presentation>;
const toAnimated = async (page: Page) => {
  await page.getByRole("radio", { name: "Animated", exact: true }).click();
  await expect(page.getByRole("button", { name: "Open Background Studio" })).toBeVisible();
};

test.describe("animated backgrounds in the Presentation panel (browser mock)", () => {
  test("the Animated tab shows the fourteen looks, yours, the Studio button and the still frame", async ({
    page,
  }) => {
    await open(page);
    await toAnimated(page);
    const p = await presentation(page);
    expect(p.background.type).toBe("shader");
    for (const name of [
      "Aurora",
      "Orbs",
      "Waves",
      "Liquid",
      "Cells",
      "Ripples",
      "Rays",
      "Starfield",
      "Weave",
      "Haze",
      "Sunrise",
      "Lava",
      "Glacier",
      "Midnight",
    ]) {
      await expect(
        page.getByRole("region", { name: "Background" }).getByRole("button", { name, exact: true }),
      ).toBeVisible();
    }
    await expect(page.getByText("No animated looks of your own yet")).toBeVisible();
    await expect(page.getByText("Still frame", { exact: true })).toBeVisible();
    await expect(page.getByRole("switch", { name: "Animate in editor" })).toBeChecked();
    await page.getByTestId("presentation-panel").screenshot({
      path: "test-results/animated-tab.png",
      animations: "disabled",
    });
  });

  test("a look applies at once, is marked, and one undo takes it back", async ({ page }) => {
    await open(page);
    await toAnimated(page);
    const lava = page
      .getByRole("region", { name: "Background" })
      .getByRole("button", { name: "Lava", exact: true });
    await lava.click();
    await expect(lava).toHaveAttribute("aria-pressed", "true");
    const p = await presentation(page);
    expect(p.background).toMatchObject({ type: "shader", engine: 1 });
    expect((p.background as { layers: { kind: string }[] }).layers.map((l) => l.kind)).toContain(
      "liquid",
    );
    await page.keyboard.press("ControlOrMeta+z");
    expect(await presentation(page)).toMatchObject({
      background: { type: "shader" },
    });
    expect((await presentation(page)).background).not.toEqual(p.background);
  });

  test("the still frame slider moves the moment of every picture and is one undo step", async ({
    page,
  }) => {
    await open(page);
    await toAnimated(page);
    const before = (await presentation(page)).background as { poster: number; loop: number };
    await expect(
      page.getByText(`${before.poster.toFixed(1)} s of ${String(before.loop)} s`),
    ).toBeVisible();
    const slider = page.getByRole("slider", { name: "Still frame" });
    await slider.focus();
    await page.keyboard.press("End");
    const after = (await presentation(page)).background as { poster: number };
    expect(after.poster).toBeGreaterThan(before.poster);
    expect(after.poster).toBeLessThan(before.loop);
    await page.keyboard.press("ControlOrMeta+z");
    expect(((await presentation(page)).background as { poster: number }).poster).toBe(
      before.poster,
    );
  });

  test("the animation plays in the editor and stops when it is switched off", async ({ page }) => {
    await open(page);
    await toAnimated(page);
    const canvas = page.getByTestId("editor-canvas");
    const shot = async () => canvas.screenshot({ animations: "disabled" });
    const first = await shot();
    await page.waitForTimeout(700);
    const second = await shot();
    expect(Buffer.compare(first, second), "the picture moves").not.toBe(0);
    await page.getByRole("switch", { name: "Animate in editor" }).click();
    await page.waitForTimeout(150);
    const still = await shot();
    await page.waitForTimeout(500);
    expect(Buffer.compare(still, await shot()), "the picture stands still").toBe(0);
  });

  test("Open Background Studio asks for the Studio", async ({ page }) => {
    await open(page);
    await toAnimated(page);
    await page.getByRole("button", { name: "Open Background Studio" }).click();
    expect(await page.evaluate(() => window.__lumengrabEditor?.ui.getState().studio)).toBe(true);
  });

  test("Use this frame as picture turns the animation into an image, and undo brings it back", async ({
    page,
  }) => {
    await open(page);
    await toAnimated(page);
    await page.getByRole("button", { name: "Use this frame as picture" }).click();
    const dialog = page.getByRole("dialog", { name: "Use this frame as picture?" });
    await expect(dialog).toBeVisible();
    await expect(dialog.getByText("Still frame ·")).toBeVisible();
    await dialog.getByRole("button", { name: "Cancel" }).click();
    expect((await presentation(page)).background.type).toBe("shader");

    await page.getByRole("button", { name: "Use this frame as picture" }).click();
    await page
      .getByRole("dialog", { name: "Use this frame as picture?" })
      .getByRole("button", { name: "Use as picture" })
      .click();
    await expect.poll(async () => (await presentation(page)).background.type).toBe("image");
    const bg = (await presentation(page)).background as { asset: string; fit: string };
    expect(bg.asset).toMatch(/^[0-9a-f]{64}\.png$/);
    expect(bg.fit).toBe("cover");
    await page.keyboard.press("ControlOrMeta+z");
    expect((await presentation(page)).background.type).toBe("shader");
  });

  test("without WebGL a notice says so, the plain colour is used and nothing breaks", async ({
    page,
  }) => {
    await page.addInitScript(() => {
      const original = HTMLCanvasElement.prototype.getContext;
      HTMLCanvasElement.prototype.getContext = function (
        this: HTMLCanvasElement,
        kind: string,
        ...rest: unknown[]
      ) {
        if (kind === "webgl" || kind === "webgl2") return null;
        return (original as (k: string, ...r: unknown[]) => unknown).call(this, kind, ...rest);
      } as typeof original;
    });
    await open(page);
    await toAnimated(page);
    await expect(
      page.getByText("Animated backgrounds need WebGL. A plain colour is used."),
    ).toBeVisible();
    await expect(page.getByRole("button", { name: "Use this frame as picture" })).toBeDisabled();
    await expect(page.getByTestId("editor-canvas")).toBeVisible();
  });
});
