import { describe, expect, it } from "vitest";
import type { TextRecognition } from "@/platform";
import { defaultProject } from "@/document/write";
import {
  codeName,
  copiedMessage,
  inSource,
  isWebLink,
  linkParts,
  projectForReading,
  summary,
  textToCopy,
  toggled,
  wordCount,
} from "./text-read";

const result: TextRecognition = {
  text: "Checkout\nanna@example.com\nTotal $48.00",
  words: 4,
  blocks: [
    { text: "Checkout", x: 10, y: 10, width: 100, height: 20 },
    { text: "anna@example.com", x: 10, y: 50, width: 200, height: 20 },
    { text: "Total $48.00", x: 10, y: 90, width: 120, height: 20 },
  ],
  codes: [],
};

describe("what is copied", () => {
  it("copies everything when nothing is picked, and only the picked blocks (in reading order) otherwise", () => {
    expect(textToCopy(result, [])).toBe(result.text);
    expect(textToCopy(result, [2, 0])).toBe("Checkout\nTotal $48.00");
    expect(textToCopy(result, [1])).toBe("anna@example.com");
  });

  it("picking a block twice lets it go again", () => {
    expect(toggled([], 1)).toEqual([1]);
    expect(toggled([1, 2], 1)).toEqual([2]);
  });

  it("counts words and says it in one line", () => {
    expect(wordCount("Order summary\nPro plan $42.00")).toBe(5);
    expect(wordCount("")).toBe(0);
    expect(copiedMessage(42)).toBe("Text copied · 42 words");
    expect(copiedMessage(1)).toBe("Text copied · 1 word");
  });
});

describe("where the boxes are", () => {
  it("a read crop starts at the crop's corner of the source picture", () => {
    expect(inSource({ x: 10, y: 20, width: 5, height: 6 }, { x: 100, y: 200 })).toEqual({
      x: 110,
      y: 220,
      width: 5,
      height: 6,
    });
  });
});

describe("what is read: the picture as exported, without the presentation", () => {
  it("turns the presentation off and keeps the crop and the layers", () => {
    const base = defaultProject();
    const project = {
      ...base,
      crop: { x: 5, y: 6, width: 100, height: 80 },
      presentation: { ...base.presentation, enabled: true },
    };
    const read = projectForReading(project);
    expect(read.presentation.enabled).toBe(false);
    expect(read.crop).toEqual(project.crop);
    expect(read.layers).toBe(project.layers);
    expect(projectForReading(base)).toBe(base);
  });
});

describe("links of QR codes", () => {
  it("offers only web addresses", () => {
    expect(isWebLink("https://lumengrab.app/docs")).toBe(true);
    expect(isWebLink("http://example.com")).toBe(true);
    for (const no of [
      "WIFI:T:WPA;S:Office;P:x;;",
      "javascript:alert(1)",
      "mailto:a@b.c",
      "https://",
      "https://bank.com@evil.example",
      "https://a b.example",
    ]) {
      expect(isWebLink(no), no).toBe(false);
    }
  });

  it("splits an address into scheme, host and the rest for the question", () => {
    expect(linkParts("https://lumengrab.app/docs/getting-started?ref=qr#install")).toEqual({
      scheme: "https://",
      host: "lumengrab.app",
      rest: "/docs/getting-started?ref=qr#install",
    });
    expect(linkParts("https://example.com")).toEqual({
      scheme: "https://",
      host: "example.com",
      rest: "",
    });
  });

  it("names one code or several", () => {
    const one = [{ value: "a", x: 0, y: 0, width: 1, height: 1 }];
    expect(codeName(one, 0)).toBe("QR code");
    expect(codeName([...one, ...one], 1)).toBe("QR code 2");
  });
});

describe("the line under the title", () => {
  it("says blocks, codes, or only codes", () => {
    expect(summary(result)).toBe("3 blocks · read on this device");
    const code = { value: "https://x.example", x: 0, y: 0, width: 1, height: 1 };
    expect(summary({ ...result, codes: [code] })).toBe("1 code · 3 text blocks");
    expect(summary({ ...result, blocks: [], codes: [code, code] })).toBe("2 codes · no text");
  });
});
