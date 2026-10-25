import type { Project, Rect } from "@/document/schema";
import type { TextCode, TextRecognition } from "@/platform";

/** What the Text panel shows (design: "M6 / Editor text"). `null` in the store: the panel is closed. */
export type TextState =
  | { status: "reading" }
  | {
      status: "done";
      result: TextRecognition;
      /** Indices of the blocks the user picked on the picture or in the list. */
      selected: readonly number[];
      /** Where the read picture starts in the source picture (the crop's corner). */
      origin: { x: number; y: number };
    }
  | { status: "empty" }
  | { status: "error"; message: string; noLanguagePack: boolean };

/**
 * The project as the text is read from it: the picture with its crop, its annotations and its redactions
 * baked in (what the export makes), without the presentation around it. A redaction destroys the pixels,
 * so text that was redacted is not there to be read.
 */
export function projectForReading(project: Project): Project {
  return project.presentation.enabled
    ? { ...project, presentation: { ...project.presentation, enabled: false } }
    : project;
}

/** A box of the read picture in the source picture (the editor draws in source pixels). */
export function inSource(
  box: { x: number; y: number; width: number; height: number },
  origin: { x: number; y: number },
): Rect {
  return { x: box.x + origin.x, y: box.y + origin.y, width: box.width, height: box.height };
}

/** The text of the picked blocks (in reading order), or of all blocks when none is picked. */
export function textToCopy(result: TextRecognition, selected: readonly number[]): string {
  if (selected.length === 0) return result.text;
  return [...selected]
    .sort((a, b) => a - b)
    .map((i) => result.blocks[i]?.text ?? "")
    .filter(Boolean)
    .join("\n");
}

export function wordCount(text: string): number {
  return text.split(/\s+/).filter(Boolean).length;
}

/** `Text copied · 42 words`. */
export function copiedMessage(words: number): string {
  return `Text copied · ${String(words)} ${words === 1 ? "word" : "words"}`;
}

/** Picks a block or lets it go (a click on the picture or in the list). */
export function toggled(selected: readonly number[], index: number): number[] {
  return selected.includes(index) ? selected.filter((i) => i !== index) : [...selected, index];
}

/** Whether a QR code holds a web address that may be offered for opening. */
export function isWebLink(value: string): boolean {
  if (/\s/.test(value) || value.length > 2048) return false;
  const match = /^https?:\/\/([^/?#]*)/i.exec(value);
  const host = match?.[1] ?? "";
  // The same rule as `is_openable_link` in src-tauri/src/ocr.rs: a real host, no credentials in front of it.
  return host !== "" && !host.includes("@") && /[a-z0-9]/i.test(host);
}

/** A web address in the three parts the question shows: the scheme, the host (in bold), the rest. */
export function linkParts(link: string): { scheme: string; host: string; rest: string } {
  const match = /^(https?:\/\/)([^/?#]*)(.*)$/i.exec(link);
  if (!match) return { scheme: "", host: link, rest: "" };
  return { scheme: match[1] ?? "", host: match[2] ?? "", rest: match[3] ?? "" };
}

/** `QR code` for one code, `QR code 2` for several. */
export function codeName(codes: readonly TextCode[], index: number): string {
  return codes.length > 1 ? `QR code ${String(index + 1)}` : "QR code";
}

/** The one line under the panel's title. */
export function summary(result: TextRecognition): string {
  const blocks = result.blocks.length;
  const codes = result.codes.length;
  const blockText = `${String(blocks)} block${blocks === 1 ? "" : "s"}`;
  if (codes === 0) return `${blockText} · read on this device`;
  const codeText = `${String(codes)} code${codes === 1 ? "" : "s"}`;
  return blocks === 0
    ? `${codeText} · no text`
    : `${codeText} · ${String(blocks)} text block${blocks === 1 ? "" : "s"}`;
}
