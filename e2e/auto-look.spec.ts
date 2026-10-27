import { expect, test, type Page } from "@playwright/test";

// The automatic look (docs/adr/0007): the hidden page gets a capture from the native side, draws the
// default look and answers with the finished PNG. Here the native side is the mock: the test sends the
// capture in and reads the answer.
test.use({ viewport: { width: 400, height: 300 } });

const SENT = { width: 200, height: 100 };

type Answer =
  | { missing: true }
  | { error: string }
  | { width: number; height: number; centre: number[]; corner: number[] };

/** Sends a plain red 200 x 100 picture as request `id` and returns what the page answered, decoded. */
async function ask(page: Page, id: number): Promise<Answer> {
  return page.evaluate(
    async ({ id: requestId, size }) => {
      const canvas = new OffscreenCanvas(size.width, size.height);
      const ctx = canvas.getContext("2d");
      if (!ctx) throw new Error("no 2d context");
      ctx.fillStyle = "#ff0000";
      ctx.fillRect(0, 0, size.width, size.height);
      const picture = ctx.getImageData(0, 0, size.width, size.height);
      const mock = window.__lumengrabMock;
      if (!mock?.present) throw new Error("the page is not listening");
      mock.present(requestId, { width: size.width, height: size.height, rgba: picture.data });
      for (let i = 0; i < 100 && !mock.presented?.[requestId]; i += 1)
        await new Promise((r) => setTimeout(r, 50));
      const answer = mock.presented?.[requestId];
      if (!answer) return { missing: true as const };
      if ("error" in answer) return { error: answer.error };
      const px = (x: number, y: number) =>
        Array.from(
          answer.rgba.subarray((y * answer.width + x) * 4, (y * answer.width + x) * 4 + 4),
        );
      return {
        width: answer.width,
        height: answer.height,
        centre: px(Math.floor(answer.width / 2), Math.floor(answer.height / 2)),
        corner: px(2, 2),
      };
    },
    { id, size: SENT },
  );
}

const ready = async (page: Page) => {
  await page.goto("/?window=present");
  await page.waitForFunction(() => window.__lumengrabMock?.present !== undefined);
};

test.describe("automatic look (browser mock)", () => {
  test("a capture comes back with the factory look around it", async ({ page }) => {
    await ready(page);
    const result = await ask(page, 1);
    if (!("width" in result)) throw new Error(JSON.stringify(result));
    // The factory look (Midnight) with the default padding (64 px at 1280, scaled to 200 px wide: 16 px).
    expect(result.width).toBeGreaterThan(SENT.width);
    expect(result.height).toBeGreaterThan(SENT.height);
    expect(result.centre.slice(0, 3)).toEqual([255, 0, 0]); // the capture itself, untouched
    expect(result.corner[2]).toBeGreaterThan(result.corner[0] ?? 0); // dark navy, not red
  });

  test("the default look of the user is used, including its exact output size", async ({
    page,
  }) => {
    await page.addInitScript(() => {
      window.localStorage.setItem(
        "lumengrab.mock.looks",
        JSON.stringify({
          version: 1,
          looks: [],
          defaultLook: {
            id: "d",
            name: "Story",
            parts: {
              background: { type: "solid", color: "#00FF00" },
              aspect: {
                mode: "fixed",
                ratio: [1080, 1920],
                size: [1080, 1920],
                preset: "instagram-story",
              },
            },
          },
        }),
      );
    });
    await ready(page);
    const result = await ask(page, 2);
    if (!("width" in result)) throw new Error(JSON.stringify(result));
    expect([result.width, result.height]).toEqual([1080, 1920]);
    expect(result.corner.slice(0, 3)).toEqual([0, 255, 0]);
  });

  test("a look whose picture is gone is an error, so the capture goes out as it was", async ({
    page,
  }) => {
    await page.addInitScript(() => {
      window.localStorage.setItem(
        "lumengrab.mock.looks",
        JSON.stringify({
          version: 1,
          looks: [],
          defaultLook: {
            id: "p",
            name: "Photo",
            parts: { background: { type: "image", asset: `${"a".repeat(64)}.png`, fit: "cover" } },
          },
        }),
      );
    });
    await ready(page);
    const result = await ask(page, 3);
    expect(result).toEqual({ error: "A picture of the look is missing." });
  });

  test("a kept original opens in the editor with the default look on as a presentation", async ({
    page,
  }) => {
    await page.addInitScript(() => {
      window.localStorage.setItem(
        "lumengrab.mock.looks",
        JSON.stringify({
          version: 1,
          looks: [],
          defaultLook: {
            id: "d",
            name: "Green",
            parts: { background: { type: "solid", color: "#00FF00" } },
          },
        }),
      );
    });
    await page.setViewportSize({ width: 1280, height: 880 });
    await page.goto("/?window=document&label=doc-1&kind=capture&applylook=1");
    await page.waitForFunction(
      () => window.__lumengrabEditor?.editor.getState().project.presentation.enabled === true,
    );
    const state = await page.evaluate(() => ({
      background: window.__lumengrabEditor?.editor.getState().project.presentation.background,
      mode: window.__lumengrabEditor?.ui.getState().mode,
    }));
    expect(state.background).toEqual({ type: "solid", color: "#00FF00" });
    expect(state.mode).toBe("annotate"); // the look is on, the tools are still there
    // A capture that is not an original stays plain.
    await page.goto("/?window=document&label=doc-1&kind=capture");
    await expect(page.getByTestId("editor-canvas")).toBeVisible();
    expect(
      await page.evaluate(
        () => window.__lumengrabEditor?.editor.getState().project.presentation.enabled,
      ),
    ).toBe(false);
  });

  test("a capture that opens in the Presentation tab gets the user's own default look, not the factory one", async ({
    page,
  }) => {
    await page.addInitScript(() => {
      window.localStorage.setItem(
        "lumengrab.mock.looks",
        JSON.stringify({
          version: 1,
          looks: [],
          defaultLook: {
            id: "d",
            name: "Green",
            parts: { background: { type: "solid", color: "#00FF00" } },
          },
        }),
      );
      window.localStorage.setItem(
        "lumengrab.mock.settings",
        JSON.stringify({ presentation: { auto: true, openInPresentation: true } }),
      );
    });
    await page.setViewportSize({ width: 1280, height: 880 });
    await page.goto("/?window=document&label=doc-1&kind=capture");
    await page.waitForFunction(
      () => window.__lumengrabEditor?.ui.getState().mode === "presentation",
    );
    await page.waitForFunction(
      () => window.__lumengrabEditor?.editor.getState().project.presentation.enabled === true,
    );
    const background = await page.evaluate(
      () => window.__lumengrabEditor?.editor.getState().project.presentation.background,
    );
    expect(background).toEqual({ type: "solid", color: "#00FF00" });
  });
});
