import { describe, expect, it } from "vitest";
import { defaultProject } from "@/document/write";
import { assetNameOf, imageExtension, MAX_ASSET_BYTES, pruneAssets, usedAssets } from "./assets";

const png = Uint8Array.of(0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 0);
const jpg = Uint8Array.of(0xff, 0xd8, 0xff, 0xe0, 0, 0);
const webp = Uint8Array.of(0x52, 0x49, 0x46, 0x46, 1, 2, 3, 4, 0x57, 0x45, 0x42, 0x50);

describe("background assets", () => {
  it("knows PNG, JPEG and WebP by their first bytes", () => {
    expect(imageExtension(png)).toBe("png");
    expect(imageExtension(jpg)).toBe("jpg");
    expect(imageExtension(webp)).toBe("webp");
    expect(imageExtension(Uint8Array.of(1, 2, 3))).toBeNull();
    expect(imageExtension(new TextEncoder().encode("<svg></svg>"))).toBeNull();
  });

  it("names a picture by its hash and refuses other files and huge ones", async () => {
    const named = await assetNameOf(png);
    expect("name" in named && named.name).toMatch(/^[0-9a-f]{64}\.png$/);
    expect(await assetNameOf(Uint8Array.of(1, 2, 3, 4))).toEqual({
      error: "Only PNG, JPEG and WebP pictures can be a background.",
    });
    expect(await assetNameOf(new Uint8Array(MAX_ASSET_BYTES + 1))).toEqual({
      error: "This picture is larger than 20 MB.",
    });
  });

  it("keeps only the assets the project uses", () => {
    const project = defaultProject();
    const assets = { "a.png": png, "b.png": png };
    expect(pruneAssets(assets, project)).toEqual({});
    project.presentation.background = { type: "image", asset: "b.png", fit: "cover" };
    expect(usedAssets(project)).toEqual(["b.png"]);
    expect(Object.keys(pruneAssets(assets, project))).toEqual(["b.png"]);
  });
});
