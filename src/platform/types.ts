/** Typed contract between the UI and the OS. Real impl: native.ts, browser impl: mock/index.ts. */

export type CaptureMode = "area" | "window" | "fullscreen";

/** Rectangle in physical pixels of one display's frozen frame (never CSS pixels). */
export interface PixelRect {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface OverlayDisplay {
  id: number;
  name: string;
  /** Size of the frozen frame in physical pixels. */
  pixelWidth: number;
  pixelHeight: number;
  /** Pixels per OS unit (informational). */
  scale: number;
}

/** A selectable window, in pixels relative to this display's frame. */
export interface OverlayWindowInfo extends PixelRect {
  id: number;
  title: string;
  appName: string;
}

export interface OverlaySession {
  mode: Exclude<CaptureMode, "fullscreen">;
  display: OverlayDisplay;
  /** URL of the frozen frame for an <img>. */
  frameUrl: string;
  /** Selectable windows, front to back. Always present: the overlay can switch between area and window mode. */
  windows: OverlayWindowInfo[];
}

export interface AppInfo {
  name: string;
  version: string;
  runtime: "native" | "browser-mock";
}

export interface Platform {
  getAppInfo(): Promise<AppInfo>;
  /** Starts a capture exactly as the global hotkey would. */
  startCapture(mode: CaptureMode): Promise<void>;
  getOverlaySession(sessionId: string, displayId: number): Promise<OverlaySession>;
  /** The overlay painted its frame: the native side may show the window now. */
  overlayReady(sessionId: string, displayId: number): Promise<void>;
  submitArea(sessionId: string, displayId: number, rect: PixelRect): Promise<void>;
  submitWindow(sessionId: string, windowId: number): Promise<void>;
  cancelCapture(sessionId: string): Promise<void>;
}

export class PlatformError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "PlatformError";
  }
}
