/** Why a file could not be opened. Each code maps to one friendly sentence; the detail names the exact problem. */
export type DocumentErrorCode =
  | "not-a-zip"
  | "too-large"
  | "too-many-entries"
  | "bad-entry-name"
  | "missing-entry"
  | "bad-json"
  | "invalid-field"
  | "wrong-format"
  | "image-too-large"
  | "bad-image";

const USER_MESSAGES: Record<DocumentErrorCode, string> = {
  "not-a-zip": "The file is damaged or incomplete. Your original file was not changed.",
  "too-large": "This file is too large to open safely. Your original file was not changed.",
  "too-many-entries":
    "The file contains more parts than a LumenGrab file should. Your original file was not changed.",
  "bad-entry-name":
    "The file contains a part with an unsafe name, so it was not opened. Your original file was not changed.",
  "missing-entry": "The file is damaged or incomplete. Your original file was not changed.",
  "bad-json": "The file is damaged or incomplete. Your original file was not changed.",
  "invalid-field": "The file is damaged or incomplete. Your original file was not changed.",
  "wrong-format": "This is not a LumenGrab file. Your original file was not changed.",
  "image-too-large":
    "The picture in this file is too large to open safely. Your original file was not changed.",
  "bad-image": "The picture in this file is damaged. Your original file was not changed.",
};

/**
 * Thrown for any file that cannot be read. Opening a bad file must end in this error and a friendly
 * dialog, never in a crash or a half-open document.
 */
export class DocumentError extends Error {
  readonly code: DocumentErrorCode;
  /** One line for the dialog, e.g. `project.json: invalid or missing field “layers”`. */
  readonly detail: string;

  constructor(code: DocumentErrorCode, detail: string) {
    super(`${code}: ${detail}`);
    this.name = "DocumentError";
    this.code = code;
    this.detail = detail;
  }

  /** The sentence shown to the user. */
  get userMessage(): string {
    return USER_MESSAGES[this.code];
  }
}
