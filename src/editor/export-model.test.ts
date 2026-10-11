import { describe, expect, it } from "vitest";
import { defaultProject } from "@/document/write";
import type { Layer } from "@/document/schema";
import { counter, group, rect, redaction } from "./model/test-layers";
import {
  approxSize,
  baseName,
  contentSize,
  countRedactions,
  customSize,
  describeEdits,
  editedLabel,
  fileNameFor,
  redactionNote,
  scaleOf,
  sizeForScale,
} from "./export-model";

const project = (
  layers: Layer[],
  crop: { x: number; y: number; width: number; height: number } | null = null,
) => ({
  ...defaultProject(),
  layers,
  crop,
});

describe("export sizes", () => {
  const content = { width: 1600, height: 1000 };
  it("starts from the crop or the picture and scales it", () => {
    expect(contentSize(project([]), { width: 1600, height: 1000 })).toEqual(content);
    expect(contentSize(project([], { x: 10, y: 10, width: 800.4, height: 500 }), content)).toEqual({
      width: 800,
      height: 500,
    });
    expect(sizeForScale(content, 0.5)).toEqual({ width: 800, height: 500 });
    expect(sizeForScale(content, 2)).toEqual({ width: 3200, height: 2000 });
    expect(sizeForScale({ width: 1, height: 1 }, 0.5)).toEqual({ width: 1, height: 1 });
  });

  it("knows which scale chip a size is", () => {
    expect(scaleOf(content, { width: 800, height: 500 })).toBe(0.5);
    expect(scaleOf(content, content)).toBe(1);
    expect(scaleOf(content, { width: 3200, height: 2000 })).toBe(2);
    expect(scaleOf(content, { width: 1000, height: 625 })).toBe("custom");
  });

  it("a custom side drags the other along when locked, and not when free", () => {
    expect(customSize(content, content, "width", 800, true)).toEqual({ width: 800, height: 500 });
    expect(customSize(content, content, "height", 250, true)).toEqual({ width: 400, height: 250 });
    expect(customSize(content, content, "width", 800, false)).toEqual({ width: 800, height: 1000 });
    expect(customSize(content, content, "width", 0, false).width).toBe(1);
  });

  it("never goes beyond the 16k limit of the format", () => {
    const big = customSize(content, content, "width", 40000, true);
    expect(big.width).toBe(16384);
    expect(big.height).toBe(10240);
    expect(customSize(content, content, "width", 40000, false).width).toBe(16384);
  });
});

describe("names and notes", () => {
  it("names the file after the document with the extension of the format", () => {
    expect(baseName("Screenshot 2026-10-09 at 14.02.lumengrab")).toBe(
      "Screenshot 2026-10-09 at 14.02",
    );
    expect(baseName("photo.JPEG")).toBe("photo");
    expect(fileNameFor("Shot.lumengrab", "webp")).toBe("Shot.webp");
    expect(fileNameFor("", "png")).toBe("Screenshot.png");
    expect(fileNameFor("Shot", "lumengrab")).toBe("Shot.lumengrab");
  });

  it("counts the redactions a flat export burns in, not the hidden ones", () => {
    const hidden = { ...redaction("h"), visible: false } as Layer;
    const p = project([redaction("a"), hidden, group("g", [redaction("b"), counter("c", 1)])]);
    expect(countRedactions(p)).toBe(2);
    expect(redactionNote(1)).toBe(
      "1 redaction is burned into the image. The pixels underneath are gone.",
    );
    expect(redactionNote(2)).toBe(
      "2 redactions are burned into the image. The pixels underneath are gone.",
    );
  });

  it("describes the edits for the recovery list", () => {
    expect(describeEdits(project([]))).toBe("no changes yet");
    expect(describeEdits(project([rect("a"), counter("b", 1), group("g", [rect("c")])]))).toBe(
      "3 annotations",
    );
    expect(describeEdits(project([redaction("a")]))).toBe("1 redaction");
    expect(
      describeEdits(project([rect("a"), redaction("b")], { x: 0, y: 0, width: 5, height: 5 })),
    ).toBe("1 annotation, 1 redaction, cropped");
  });

  it("formats sizes and times", () => {
    expect(approxSize(300)).toBe("about 300 B");
    expect(approxSize(380 * 1024)).toBe("about 380 KB");
    expect(approxSize(2.5 * 1024 * 1024)).toBe("about 2.5 MB");
    const now = new Date(2026, 9, 11, 15, 0);
    expect(editedLabel(new Date(2026, 9, 11, 9, 5).getTime(), now)).toBe("Edited today, 09:05");
    expect(editedLabel(new Date(2026, 9, 10, 22, 48).getTime(), now)).toBe(
      "Edited yesterday, 22:48",
    );
    expect(editedLabel(new Date(2026, 9, 3, 7, 1).getTime(), now)).toBe("Edited 3 Oct, 07:01");
  });
});
