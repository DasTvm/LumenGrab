import { strFromU8 } from "fflate";
import { readContainer } from "./container";
import { DocumentError } from "./errors";
import { sha256Hex } from "./hash";
import { BUNDLED_FONT_IDS, FORMAT_VERSION, LIMITS, type Limits } from "./limits";
import { countLayers, walkLayers } from "./layers";
import { migrateToLatest } from "./migrations";
import { readPngSize } from "./png";
import { ManifestSchema, ProjectSchema, type Manifest, type Project } from "./schema";
import type { DocumentFile, DocumentWarning, OpenedDocument, ReadOnlyInfo } from "./types";
import type { z } from "zod";

const ASSET_ENTRY = /^assets\/[0-9a-f]{64}\.[a-z0-9]{1,8}$/;
const REQUIRED = ["manifest.json", "project.json", "source.png"] as const;

type Issue = z.core.$ZodIssue;

/** The path of the most specific problem, e.g. `layers.2.width`. Union errors carry their branches' issues. */
function describeIssue(issue: Issue): string {
  if (issue.code === "invalid_union" && issue.errors.length > 0) {
    const inner = issue.errors[0]?.[0];
    if (inner) return describeIssue({ ...inner, path: [...issue.path, ...inner.path] });
  }
  return issue.path.map(String).join(".") || "(file)";
}

function parseWith<T extends z.ZodType>(schema: T, raw: unknown, file: string): z.infer<T> {
  const result = schema.safeParse(raw);
  if (result.success) return result.data;
  const issue = result.error.issues[0];
  const where = issue ? describeIssue(issue) : "(file)";
  throw new DocumentError("invalid-field", `${file}: invalid or missing field “${where}”`);
}

function parseJsonEntry(bytes: Uint8Array, file: string, limits: Limits): Record<string, unknown> {
  if (bytes.length > limits.maxJsonBytes) {
    throw new DocumentError(
      "too-large",
      `${file}: larger than ${String(limits.maxJsonBytes / 1048576)} MB`,
    );
  }
  let value: unknown;
  try {
    value = JSON.parse(strFromU8(bytes));
  } catch {
    throw new DocumentError("bad-json", `${file}: not valid JSON`);
  }
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new DocumentError("bad-json", `${file}: not a JSON object`);
  }
  return value as Record<string, unknown>;
}

function textFonts(project: Project): string[] {
  const ids = new Set<string>();
  walkLayers(project.layers, (layer) => {
    if (layer.type === "text" && typeof layer["fontId"] === "string") ids.add(layer["fontId"]);
  });
  return [...ids];
}

/**
 * Opens a `.lumengrab` file (docs/FORMAT.md section 6). Corrupt or hostile input ends in a
 * `DocumentError`, never in a crash. Oddities that still allow editing become `warnings`; a file
 * from a newer version comes back with `readOnly` set.
 */
export async function openDocument(
  bytes: Uint8Array,
  limits: Limits = LIMITS,
): Promise<OpenedDocument> {
  const entries = readContainer(bytes, limits);
  for (const name of REQUIRED) {
    if (!entries.has(name)) throw new DocumentError("missing-entry", `${name} is missing`);
  }
  const need = (name: string): Uint8Array => {
    const entry = entries.get(name);
    if (!entry) throw new DocumentError("missing-entry", `${name} is missing`);
    return entry;
  };

  const rawManifest = parseJsonEntry(need("manifest.json"), "manifest.json", limits);
  if (rawManifest["format"] !== "lumengrab") {
    throw new DocumentError("wrong-format", "manifest.json: format is not “lumengrab”");
  }
  const manifest: Manifest = parseWith(ManifestSchema, rawManifest, "manifest.json");

  const readOnly: ReadOnlyInfo | null =
    manifest.minReaderVersion > FORMAT_VERSION
      ? {
          reason: "newer-version",
          fileVersion: manifest.formatVersion,
          minReaderVersion: manifest.minReaderVersion,
          supportedVersion: FORMAT_VERSION,
        }
      : null;

  const rawProject = parseJsonEntry(need("project.json"), "project.json", limits);
  let project: Project | null;
  if (readOnly) {
    // A newer file may not fit this version's schema. Viewing needs only the preview and the manifest.
    const parsed = ProjectSchema.safeParse(rawProject);
    project = parsed.success ? parsed.data : null;
  } else {
    const version = rawProject["version"];
    if (typeof version !== "number" || !Number.isInteger(version) || version < 1) {
      throw new DocumentError("invalid-field", "project.json: invalid or missing field “version”");
    }
    project = parseWith(ProjectSchema, migrateToLatest(rawProject, version), "project.json");
    if (countLayers(project.layers) > limits.maxLayers) {
      throw new DocumentError(
        "too-large",
        `project.json: more than ${String(limits.maxLayers)} layers`,
      );
    }
  }

  const source = need("source.png");
  const size = readPngSize(source, "source.png", limits.maxImageEdge);

  const warnings: DocumentWarning[] = [];
  if (size.width !== manifest.source.width || size.height !== manifest.source.height) {
    warnings.push({
      code: "source-size",
      message: "The picture in this file has a different size than the file says.",
    });
  }
  if ((await sha256Hex(source)) !== manifest.source.sha256) {
    warnings.push({
      code: "source-hash",
      message:
        "The picture in this file does not match its checksum. It may have been changed or damaged.",
    });
  }

  const assets: Record<string, Uint8Array> = {};
  const extraEntries: Record<string, Uint8Array> = {};
  let preview: Uint8Array | null = null;
  for (const [name, data] of entries) {
    if (name === "preview.png") preview = data;
    else if ((REQUIRED as readonly string[]).includes(name)) continue;
    else if (ASSET_ENTRY.test(name)) assets[name.slice("assets/".length)] = data;
    else extraEntries[name] = data;
  }
  if (!preview) {
    warnings.push({
      code: "missing-preview",
      message: "The preview image is missing. It is created again when you save.",
    });
  }

  for (const [file, data] of Object.entries(assets)) {
    if ((await sha256Hex(data)) !== file.slice(0, 64)) {
      warnings.push({
        code: "asset-hash",
        message: `An image inside the file (“${file.slice(0, 8)}…”) does not match its checksum.`,
      });
    }
  }
  if (project) {
    const background = project.presentation.background;
    if (background.type === "image" && !(background.asset in assets)) {
      warnings.push({
        code: "missing-asset",
        message: "The background image of this file is missing. A plain background is used.",
      });
    }
    for (const fontId of textFonts(project)) {
      if (!BUNDLED_FONT_IDS.includes(fontId)) {
        warnings.push({
          code: "unknown-font",
          message: `The font “${fontId}” is not available. The default font is used.`,
        });
      }
    }
  }

  const doc: DocumentFile = { manifest, project, source, preview, assets, extraEntries };
  return { doc, warnings, readOnly };
}
