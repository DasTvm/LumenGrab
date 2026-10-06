/** Typed contract between the UI and the OS. Real impl: native.ts, browser impl: mock/index.ts. */

export type CaptureMode = "area" | "window" | "fullscreen";

export interface CaptureResult {
  /** URL the UI can put into an <img>. */
  imageUrl: string;
  /** Size in source-image pixels. */
  width: number;
  height: number;
  /** Display scale of the captured screen (1, 2, ...). */
  scale: number;
}

export interface AppInfo {
  name: string;
  version: string;
  runtime: "native" | "browser-mock";
}

export interface Platform {
  getAppInfo(): Promise<AppInfo>;
  capture(mode: CaptureMode): Promise<CaptureResult>;
}

export class PlatformError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "PlatformError";
  }
}
