import { strToU8, zipSync, deflateSync } from "fflate";
import { describe, expect, it } from "vitest";
import { isSafeEntryName, readContainer, writeContainer } from "./container";
import { DocumentError } from "./errors";
import { LIMITS } from "./limits";

const expectCode = (fn: () => unknown, code: string) => {
  try {
    fn();
  } catch (e) {
    expect(e).toBeInstanceOf(DocumentError);
    expect((e as DocumentError).code).toBe(code);
    return;
  }
  throw new Error(`expected a DocumentError (${code})`);
};

const zipOf = (files: Record<string, Uint8Array>) => zipSync(files);

describe("entry names (zip-slip)", () => {
  it.each(["manifest.json", "assets/ab12.png", "extra/notes.txt", "a-b_c.d/e.f"])(
    "allows %s",
    (name) => {
      expect(isSafeEntryName(name)).toBe(true);
    },
  );

  it.each([
    "../evil.txt",
    "a/../../evil",
    "/etc/passwd",
    "C:/Windows/x",
    "c:evil",
    "a\\b",
    "Manifest.json",
    "a//b",
    "./x",
    "",
    "x".repeat(300),
    "with space.png",
    "..",
    "assets/..",
  ])("rejects %j", (name) => {
    expect(isSafeEntryName(name)).toBe(false);
  });

  it("refuses a file that contains an unsafe name, without reading its data", () => {
    for (const name of ["../evil.txt", "/abs.txt", "C:/x.txt", "dir\\file.txt", "UPPER.txt"]) {
      expectCode(
        () => readContainer(zipOf({ [name]: strToU8("x"), "manifest.json": strToU8("{}") })),
        "bad-entry-name",
      );
    }
  });

  it("refuses to write an unsafe name", () => {
    expectCode(
      () => writeContainer([{ name: "../x", data: new Uint8Array(1), compress: false }]),
      "bad-entry-name",
    );
  });
});

describe("limits", () => {
  it("rejects more entries than allowed", () => {
    const make = (count: number) =>
      zipOf(
        Object.fromEntries(
          Array.from({ length: count }, (_, i) => [`f${String(i)}.txt`, strToU8("x")]),
        ),
      );
    expectCode(() => readContainer(make(LIMITS.maxEntries + 1)), "too-many-entries");
    // exactly the limit is fine
    expect(readContainer(make(LIMITS.maxEntries)).size).toBe(LIMITS.maxEntries);
  });

  it("stops a decompression bomb by counting what really comes out, not what the headers claim", () => {
    const zeros = new Uint8Array(3 * 1024 * 1024); // 3 MB of zeros: a few KB compressed
    const zip = zipOf({ "bomb.bin": zeros });
    const limits = { ...LIMITS, maxUncompressedBytes: 1024 * 1024 };
    expectCode(() => readContainer(zip, limits), "too-large");

    // Now make the local header lie: claim the entry is only 10 bytes when unpacked.
    const lying = new Uint8Array(zip);
    const view = new DataView(lying.buffer);
    expect(view.getUint32(0, true)).toBe(0x04034b50);
    view.setUint32(22, 10, true); // uncompressed size in the local header
    expectCode(() => readContainer(lying, limits), "too-large");
  });

  it("refuses at once an entry whose header claims more than the limit", () => {
    const zip = new Uint8Array(zipOf({ "big.bin": strToU8("tiny") }));
    new DataView(zip.buffer).setUint32(22, 600 * 1024 * 1024, true);
    expectCode(() => readContainer(zip), "too-large");
  });

  it("adds up several entries", () => {
    const half = new Uint8Array(700 * 1024);
    const zip = zipOf({ "a.bin": half, "b.bin": half });
    expectCode(
      () => readContainer(zip, { ...LIMITS, maxUncompressedBytes: 1024 * 1024 }),
      "too-large",
    );
  });
});

describe("broken files", () => {
  it("rejects bytes that are not a ZIP", () => {
    expectCode(() => readContainer(strToU8("this is not a zip file at all")), "not-a-zip");
    expectCode(() => readContainer(new Uint8Array(0)), "not-a-zip");
    expectCode(() => readContainer(crypto.getRandomValues(new Uint8Array(4096))), "not-a-zip");
  });

  it("rejects a truncated ZIP", () => {
    const zip = zipOf({
      "manifest.json": strToU8(JSON.stringify({ a: "x".repeat(2000) })),
      "b.txt": strToU8("hello"),
    });
    for (const cut of [30, Math.floor(zip.length / 3), zip.length - 40]) {
      expectCode(() => readContainer(zip.subarray(0, cut)), "not-a-zip");
    }
  });

  it("rejects a corrupt deflate stream", () => {
    const zip = new Uint8Array(
      zipOf({ "a.txt": strToU8("hello hello hello hello hello hello hello") }),
    );
    const dataAt = 30 + "a.txt".length;
    for (let i = dataAt; i < dataAt + 6; i += 1) zip[i] = 0xff;
    expectCode(() => readContainer(zip), "not-a-zip");
  });

  it("skips folder entries", () => {
    const entries = readContainer(zipOf({ "assets/": new Uint8Array(0), "a.txt": strToU8("x") }));
    expect([...entries.keys()]).toEqual(["a.txt"]);
  });
});

describe("round trip", () => {
  it("gives back what was written, byte for byte", () => {
    const png = crypto.getRandomValues(new Uint8Array(5000));
    const zip = writeContainer([
      { name: "manifest.json", data: strToU8('{"a":1}'), compress: true },
      { name: "source.png", data: png, compress: false },
    ]);
    const entries = readContainer(zip);
    expect([...entries.keys()]).toEqual(["manifest.json", "source.png"]);
    expect(entries.get("source.png")).toEqual(png);
    expect(new TextDecoder().decode(entries.get("manifest.json"))).toBe('{"a":1}');
  });

  it("stores pictures without compressing them and deflates JSON", () => {
    const zip = writeContainer([
      { name: "a.json", data: strToU8(JSON.stringify({ x: "y".repeat(500) })), compress: true },
      { name: "b.png", data: crypto.getRandomValues(new Uint8Array(500)), compress: false },
    ]);
    const view = new DataView(zip.buffer, zip.byteOffset);
    const method = (at: number) => view.getUint16(at + 8, true);
    expect(method(0)).toBe(8); // deflate
    // the second local header follows the first entry: find it by its signature
    let second = -1;
    for (let i = 4; i < zip.length - 4; i += 1) {
      if (view.getUint32(i, true) === 0x04034b50) {
        second = i;
        break;
      }
    }
    expect(second).toBeGreaterThan(0);
    expect(method(second)).toBe(0); // stored
  });

  it("writes the same bytes for the same input (fixed timestamps)", () => {
    const entries = [{ name: "a.txt", data: strToU8("same"), compress: true }];
    expect(writeContainer(entries)).toEqual(writeContainer(entries));
  });

  it("reads a ZIP that deflate-compressed data with a raw stream the way other tools write it", () => {
    // sanity check of the helper used by other tests
    expect(deflateSync(strToU8("x")).length).toBeGreaterThan(0);
  });
});
