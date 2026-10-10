import { Unzip, UnzipInflate, UnzipPassThrough, zipSync, type Zippable } from "fflate";
import { DocumentError } from "./errors";
import { LIMITS, type Limits } from "./limits";

/**
 * The ZIP container of a `.lumengrab` file (docs/FORMAT.md section 2).
 *
 * Reading is **streaming** and counts the bytes that really come out of the inflater, so a hostile
 * file cannot hide a decompression bomb behind small declared sizes. Every limit is enforced while
 * reading; an entry name is checked before its data is touched.
 */

/** Entry names are lowercase, forward slashes, no `..`, no absolute paths, no drive letters (zip-slip). */
const SAFE_SEGMENT = /^[a-z0-9._-]+$/;

export function isSafeEntryName(name: string, maxLength: number = LIMITS.maxNameLength): boolean {
  if (name.length === 0 || name.length > maxLength) return false;
  return name
    .split("/")
    .every((segment) => segment !== "." && segment !== ".." && SAFE_SEGMENT.test(segment));
}

export type Entries = Map<string, Uint8Array>;

const concat = (chunks: Uint8Array[], size: number): Uint8Array => {
  const out = new Uint8Array(size);
  let at = 0;
  for (const chunk of chunks) {
    out.set(chunk, at);
    at += chunk.length;
  }
  return out;
};

/**
 * The number of entries the ZIP's end record claims, or `null` if there is no end record (the file is
 * cut off). The end record is the last 22 bytes plus an optional comment of up to 64 KB.
 */
function declaredEntryCount(bytes: Uint8Array): number | null {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const lowest = Math.max(0, bytes.length - 22 - 0xffff);
  for (let at = bytes.length - 22; at >= lowest; at -= 1) {
    if (view.getUint32(at, true) === 0x06054b50) return view.getUint16(at + 10, true);
  }
  return null;
}

/** All files of the ZIP, by name. Directory entries are skipped. Throws a `DocumentError` for anything unsafe or broken. */
export function readContainer(bytes: Uint8Array, limits: Limits = LIMITS): Entries {
  const entries: Entries = new Map();
  let failure: DocumentError | null = null;
  let files = 0;
  let seen = 0; // every entry including folders, to compare with the end record
  let total = 0;
  let unfinished = 0;
  const fail = (error: DocumentError) => {
    failure ??= error;
  };

  const unzip = new Unzip();
  unzip.register(UnzipInflate);
  unzip.register(UnzipPassThrough);
  unzip.onfile = (file) => {
    if (failure) return;
    seen += 1;
    if (file.name.endsWith("/")) return; // a folder entry: nothing to read
    files += 1;
    if (files > limits.maxEntries) {
      fail(
        new DocumentError(
          "too-many-entries",
          `more than ${String(limits.maxEntries)} entries in the file`,
        ),
      );
      return;
    }
    if (!isSafeEntryName(file.name, limits.maxNameLength)) {
      fail(new DocumentError("bad-entry-name", `unsafe entry name “${file.name.slice(0, 80)}”`));
      return;
    }
    if (entries.has(file.name)) {
      fail(new DocumentError("bad-entry-name", `entry “${file.name}” appears twice`));
      return;
    }
    if (
      file.originalSize !== undefined &&
      total + file.originalSize > limits.maxUncompressedBytes
    ) {
      fail(
        new DocumentError(
          "too-large",
          `the file would unpack to more than ${String(Math.round(limits.maxUncompressedBytes / 1048576))} MB`,
        ),
      );
      return;
    }

    const name = file.name;
    const chunks: Uint8Array[] = [];
    let size = 0;
    unfinished += 1;
    file.ondata = (error, chunk, final) => {
      if (failure) return;
      if (error) {
        fail(new DocumentError("not-a-zip", `${name}: ${error.message}`));
        file.terminate();
        return;
      }
      size += chunk.length;
      total += chunk.length;
      if (total > limits.maxUncompressedBytes) {
        fail(
          new DocumentError(
            "too-large",
            `the file unpacks to more than ${String(Math.round(limits.maxUncompressedBytes / 1048576))} MB`,
          ),
        );
        file.terminate();
        return;
      }
      chunks.push(chunk);
      if (final) {
        entries.set(name, concat(chunks, size));
        unfinished -= 1;
      }
    };
    try {
      file.start();
    } catch (e) {
      fail(
        new DocumentError(
          "not-a-zip",
          `${name}: ${e instanceof Error ? e.message : "cannot be read"}`,
        ),
      );
    }
  };

  try {
    unzip.push(bytes, true);
  } catch (e) {
    fail(
      new DocumentError(
        "not-a-zip",
        `not a valid ZIP file (${e instanceof Error ? e.message : "unreadable"})`,
      ),
    );
  }
  // `failure` is assigned inside the callbacks above, which the compiler cannot follow.
  const problem = failure as DocumentError | null;
  if (problem) throw problem;
  if (files === 0) throw new DocumentError("not-a-zip", "no ZIP entries found");
  if (unfinished > 0)
    throw new DocumentError("not-a-zip", "the file ends in the middle of an entry");
  const declared = declaredEntryCount(bytes);
  if (declared === null) throw new DocumentError("not-a-zip", "the end of the ZIP file is missing");
  // 0xFFFF means ZIP64 (not used by this format): then the count cannot be compared.
  if (declared !== 0xffff && declared !== seen) {
    throw new DocumentError(
      "not-a-zip",
      "the ZIP directory does not match the entries in the file",
    );
  }
  return entries;
}

/** One entry to write. `compress: false` stores it as it is (pictures are already compressed). */
export interface ContainerEntry {
  name: string;
  data: Uint8Array;
  compress: boolean;
}

/** 2026-01-01 00:00 UTC: every entry gets the same timestamp, so the same document always gives the same bytes. */
const FIXED_TIME = Date.UTC(2026, 0, 1);

export function writeContainer(entries: readonly ContainerEntry[]): Uint8Array {
  const files: Zippable = {};
  for (const entry of entries) {
    if (!isSafeEntryName(entry.name)) {
      throw new DocumentError(
        "bad-entry-name",
        `refusing to write an unsafe entry name “${entry.name}”`,
      );
    }
    files[entry.name] = [entry.data, { level: entry.compress ? 6 : 0, mtime: FIXED_TIME }];
  }
  return zipSync(files);
}
