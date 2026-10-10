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

/** The modes the capture bar switches between. Fullscreen is an action, not a mode. */
export type OverlayMode = Exclude<CaptureMode, "fullscreen">;

export interface OverlaySession {
  /** The current mode (the capture bar may have switched it since the start). */
  mode: OverlayMode;
  /** Started with the capture bar: the mode can be switched with the bar or the keys A / W / F. */
  toolbar: boolean;
  /** This display shows the bar and the hint. Exactly one display of a capture is home. */
  home: boolean;
  display: OverlayDisplay;
  /** URL of the frozen frame for an <img>. */
  frameUrl: string;
  /** Selectable windows, front to back. Always present: the overlay can switch between area and window mode. */
  windows: OverlayWindowInfo[];
}

export type Os = "macos" | "windows" | "other";

export interface AppInfo {
  name: string;
  version: string;
  runtime: "native" | "browser-mock";
  os: Os;
}

export interface HotkeyInfo {
  id: "capture" | "area" | "window" | "fullscreen";
  /** Key names such as `Ctrl`, `Shift`, `4`; render them with `formatKey`. */
  keys: string[];
  /** False when another app already owns the shortcut. */
  registered: boolean;
}

export type QuickAccessStyle = "compact" | "large";
export type Corner = "topLeft" | "topRight" | "bottomLeft" | "bottomRight";
/** Seconds until the Quick Access card closes by itself; 0 = never. */
export type AutoCloseSecs = 0 | 5 | 10;

/** What the user can change. Mirrors `Settings` in src-tauri/src/settings.rs. */
export interface Settings {
  /** What the main shortcut starts in. */
  defaultMode: OverlayMode;
  /** Copy every new screenshot to the clipboard (it is always saved as a file). */
  copyToClipboard: boolean;
  quickAccess: {
    enabled: boolean;
    style: QuickAccessStyle;
    autoCloseSecs: AutoCloseSecs;
    corner: Corner;
  };
  /** The Windows first-start hint was shown. */
  seenIntro: boolean;
}

export interface SettingsInfo {
  /** Absolute folder screenshots are saved to. */
  saveDir: string;
  settings: Settings;
  hotkeys: HotkeyInfo[];
}

export interface Platform {
  getAppInfo(): Promise<AppInfo>;
  /** Starts a capture like the global hotkeys: `toolbar` is the main shortcut (with the capture bar), otherwise a quick pick. */
  startCapture(mode: CaptureMode, toolbar?: boolean): Promise<void>;
  getOverlaySession(sessionId: string, displayId: number): Promise<OverlaySession>;
  /**
   * The overlay windows are created once and wait hidden. This calls `listener` with the capture a
   * waiting overlay of `displayId` should show, or `null` when it should go back to waiting.
   * Resolves to the unsubscribe function.
   */
  onOverlayAssignment(
    displayId: number,
    listener: (sessionId: string | null) => void,
  ): Promise<() => void>;
  /** The capture a freshly loaded overlay should show, if one is already running. */
  getOverlayAssignment(displayId: number): Promise<string | null>;
  /** The overlay painted its frame: the native side may show the window now. */
  overlayReady(sessionId: string, displayId: number): Promise<void>;
  submitArea(sessionId: string, displayId: number, rect: PixelRect): Promise<void>;
  submitWindow(sessionId: string, windowId: number): Promise<void>;
  cancelCapture(sessionId: string): Promise<void>;
  /** Switches the mode on every display of this capture (the capture bar shows on one display only). */
  setCaptureMode(sessionId: string, mode: OverlayMode): Promise<void>;
  /** Calls `listener` when the mode was switched on any display. Resolves to the unsubscribe function. */
  onCaptureMode(sessionId: string, listener: (mode: OverlayMode) => void): Promise<() => void>;
  /** Saves all settings. Rejects with a readable message if they could not be written. */
  saveSettings(settings: Settings): Promise<void>;
  getSettingsInfo(): Promise<SettingsInfo>;
  openScreenshotsFolder(): Promise<void>;
  /** Whether the OS currently lets LumenGrab record the screen (always true on Windows). */
  getPermissionStatus(): Promise<boolean>;
  /** Asks the OS once and opens System Settings at Screen Recording. */
  openPermissionSettings(): Promise<void>;
  closePermissionWindow(): Promise<void>;
  /** Quits and starts LumenGrab again (macOS applies a new permission only to new processes). */
  restartApp(): Promise<void>;
}

export class PlatformError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "PlatformError";
  }
}
