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
  test("the Animated tab shows the twelve looks, yours, the Studio button and the still frame", async ({
    page,
  }) => {
    await open(page);
    await toAnimated(page);
    const p = await presentation(page);
    expect(p.background.type).toBe("shader");
    for (const name of [
      "Aurora",
      "Nebula",
      "Silk",
      "Ink",
      "Dusk",
      "Haze",
      "Mist",
      "Tide",
      "Ember",
      "Midnight",
      "Spotlight",
      "Mint",
    ]) {
      await expect(
        page.getByRole("region", { name: "Background" }).getByRole("button", { name, exact: true }),
      ).toBeVisible();
    }
    await expect(page.getByText("No animated looks of your own yet")).toBeVisible();
    await expect(page.getByText("Still frame", { exact: true })).toBeVisible();
    await expect(page.getByRole("switch", { name: "Animate in editor" })).toBeChecked();
  });

  test("a look applies at once, is marked, and one undo takes it back", async ({ page }) => {
    await open(page);
    await toAnimated(page);
    const ember = page
      .getByRole("region", { name: "Background" })
      .getByRole("button", { name: "Ember", exact: true });
    await ember.click();
    await expect(ember).toHaveAttribute("aria-pressed", "true");
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

  test("a look is tuned without the Studio: speed, colours and its own sliders, each one undo step, and the look stays marked", async ({
    page,
  }) => {
    await open(page);
    await toAnimated(page);
    const region = page.getByRole("region", { name: "Background" });
    const silk = region.getByRole("button", { name: "Silk", exact: true });
    await silk.click();
    const scene = async () =>
      (await presentation(page)).background as {
        loop: number;
        poster: number;
        palette: string[];
        layers: { kind: string; params: Record<string, number> }[];
      };
    const first = await scene();
    expect(first.loop).toBe(60);

    // Speed: a shorter loop, and the still frame stays on the same picture.
    const speed = region.getByRole("slider", { name: "Speed" });
    await speed.focus();
    await page.keyboard.press("End");
    const faster = await scene();
    expect(faster.loop).toBe(6);
    expect(faster.poster / faster.loop).toBeCloseTo(first.poster / first.loop, 1);
    await page.keyboard.press("ControlOrMeta+z");
    expect((await scene()).loop).toBe(60);

    // A colour of the palette.
    await region.getByRole("button", { name: "Colour 2" }).click();
    const hex = page.getByRole("textbox", { name: "Hex colour" });
    await hex.fill("#112233");
    await hex.press("Enter");
    await expect.poll(async () => (await scene()).palette[1]).toBe("#112233");

    // The slider of the look's own layer.
    const flow = region.getByRole("slider", { name: "Flow" });
    await flow.focus();
    await page.keyboard.press("End");
    expect((await scene()).layers.find((l) => l.kind === "liquid")?.params["warp"]).toBe(2);

    // The look is still the marked one although it no longer matches exactly.
    await expect(silk).toHaveAttribute("aria-pressed", "true");
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
    // Software WebGL keeps the page busy while it plays, so the click does not wait for the switch to hold still.
    await page.getByRole("switch", { name: "Animate in editor" }).click({ force: true });
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
    // Not about playing: start paused (software WebGL is slow in CI).
    await page.emulateMedia({ reducedMotion: "reduce" });
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
      type GetContext = (this: HTMLCanvasElement, kind: string, ...rest: unknown[]) => unknown;
      const proto = HTMLCanvasElement.prototype as unknown as { getContext: GetContext };
      const original: GetContext = proto.getContext;
      proto.getContext = function (kind, ...rest) {
        if (kind === "webgl" || kind === "webgl2") return null;
        return original.call(this, kind, ...rest);
      };
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

test.describe("an animated default look (browser mock)", () => {
  test("a star makes an animated look the default, and Settings shows it and edits it in the Studio", async ({
    page,
  }) => {
    await page.emulateMedia({ reducedMotion: "reduce" });
    await open(page);
    await toAnimated(page);
    const region = page.getByRole("region", { name: "Background" });
    await region.getByRole("button", { name: "Use Ember as default" }).click();
    await expect(page.getByText("Ember is now your default look")).toBeVisible();
    await expect(region.getByRole("img", { name: "Default look" })).toBeVisible();

    await page.goto("/?window=settings&page=presentation");
    await expect(page.getByText("Ember · animated")).toBeVisible();
    await expect(page.getByText("60 s loop")).toBeVisible();
    await expect(
      page.getByText("Animated looks play in the editor and export as their still frame."),
    ).toBeVisible();
    await page.getByRole("button", { name: "Edit look" }).click();
    const studio = page.getByRole("dialog", { name: "Background Studio" });
    await expect(studio).toBeVisible();
    await studio.getByRole("button", { name: "Add", exact: true }).click();
    await page.getByRole("menuitem", { name: "Vignette" }).click();
    await studio.getByRole("button", { name: "Apply" }).click();
    await expect(studio).toHaveCount(0);
    await expect
      .poll(async () => {
        const raw = await page.evaluate(() => window.localStorage.getItem("lumengrab.mock.looks"));
        const file = JSON.parse(raw ?? "{}") as {
          defaultLook?: { parts?: { background?: { layers?: { kind: string }[] } } };
        };
        return file.defaultLook?.parts?.background?.layers?.map((l) => l.kind) ?? [];
      })
      .toContain("vignette");
  });
});
