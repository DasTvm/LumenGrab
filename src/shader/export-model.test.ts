import { describe, expect, it } from "vitest";
import {
  MAX_SIDE,
  estimateGifBytes,
  estimatePictureBytes,
  estimateVideoBytes,
  fileStem,
  fitSize,
  formatBytes,
  frameTime,
  planMotion,
  timeLeft,
} from "./export-model";

const canvas = { width: 2400, height: 1350 };

describe("export sizes", () => {
  it("fits the shape of the canvas into the box of the preset", () => {
    expect(fitSize(canvas, "1080p")).toEqual({ width: 1920, height: 1080 });
    expect(fitSize(canvas, "720p")).toEqual({ width: 1280, height: 720 });
    expect(fitSize(canvas, "4k")).toEqual({ width: 3840, height: 2160 });
    expect(fitSize(canvas, "canvas")).toEqual(canvas);
    // A tall canvas is fitted by its height and stays tall.
    expect(fitSize({ width: 1000, height: 2000 }, "1080p")).toEqual({ width: 540, height: 1080 });
  });

  it("makes the sides of a video even and never bigger than the graphics card can draw", () => {
    const v = fitSize({ width: 1001, height: 563 }, "canvas", { even: true });
    expect(v.width % 2).toBe(0);
    expect(v.height % 2).toBe(0);
    const huge = fitSize({ width: 9000, height: 3000 }, "canvas");
    expect(Math.max(huge.width, huge.height)).toBe(MAX_SIDE);
    expect(huge.width / huge.height).toBeCloseTo(3, 1);
  });
});

describe("frames and limits", () => {
  const scene = { loop: 8 };
  it("counts the frames of a loop and its repeats", () => {
    expect(planMotion(scene, { width: 1920, height: 1080 }, 30, 1, "video")).toMatchObject({
      frames: 240,
      seconds: 8,
      shortened: false,
    });
    expect(planMotion(scene, { width: 1280, height: 720 }, 24, 1, "gif").frames).toBe(192);
    expect(planMotion(scene, { width: 1920, height: 1080 }, 60, 3, "video").frames).toBe(1440);
  });

  it("shortens what is too long at 4K and 60 frames a second, and says so", () => {
    const plan = planMotion(scene, { width: 3840, height: 2160 }, 60, 5, "video");
    expect(plan.shortened).toBe(true);
    expect(plan.frames).toBe(1800);
    expect(plan.seconds).toBe(30);
    expect(plan.wanted).toBe(2400);
    expect(planMotion(scene, { width: 3840, height: 2160 }, 30, 1, "video").shortened).toBe(false);
  });

  it("never allows more than two minutes, or a huge GIF", () => {
    expect(planMotion({ loop: 60 }, { width: 640, height: 360 }, 60, 5, "video").seconds).toBe(120);
    const gif = planMotion({ loop: 60 }, { width: 1920, height: 1080 }, 24, 5, "gif");
    expect(gif.frames).toBeLessThanOrEqual(600);
    expect(gif.shortened).toBe(true);
    expect(
      planMotion(scene, { width: 4000, height: 3000 }, 24, 1, "gif").frames,
    ).toBeGreaterThanOrEqual(1);
  });

  it("puts frame i at i over fps", () => {
    expect(frameTime(0, 30)).toBe(0);
    expect(frameTime(15, 30)).toBe(0.5);
  });
});

describe("estimates and words", () => {
  const plan = planMotion({ loop: 8 }, { width: 1920, height: 1080 }, 30, 1, "video");
  it("are close to what the dialog promised in the design", () => {
    expect(formatBytes(estimateVideoBytes({ width: 1920, height: 1080 }, plan, "high"))).toBe(
      "14 MB",
    );
    expect(estimateVideoBytes({ width: 1920, height: 1080 }, plan, "low")).toBeLessThan(
      estimateVideoBytes({ width: 1920, height: 1080 }, plan, "high"),
    );
    const gif = planMotion({ loop: 8 }, { width: 1280, height: 720 }, 24, 1, "gif");
    expect(formatBytes(estimateGifBytes({ width: 1280, height: 720 }, gif, 256))).toBe("38 MB");
    expect(formatBytes(estimatePictureBytes({ width: 2400, height: 1350 }, "png"))).toBe("1.2 MB");
  });

  it("write sizes and times plainly", () => {
    expect(formatBytes(2 * 1024 * 1024)).toBe("2.0 MB");
    expect(formatBytes(640 * 1024)).toBe("640 KB");
    expect(timeLeft(1)).toBe("A few seconds left");
    expect(timeLeft(20)).toBe("About 20 seconds left");
    expect(timeLeft(200)).toBe("About 3 minutes left");
    expect(timeLeft(Number.NaN)).toBe("A few seconds left");
  });

  it("makes a file name from the name of a look", () => {
    expect(fileStem("Aurora night")).toBe("Aurora-night");
    expect(fileStem("  ../Weird: name?  ")).toBe("Weird-name");
    expect(fileStem("")).toBe("Background");
    expect(fileStem("Größe")).toBe("Größe");
  });
});
