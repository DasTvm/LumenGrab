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

/** Room around a Quick Access card inside its (transparent, larger) window, in CSS pixels. */
export interface CardPad {
  top: number;
  right: number;
  bottom: number;
  left: number;
}

/** A button on a notice card. `icon` is a name the page maps to an icon. */
export interface NoticeAction {
  label: string;
  icon: string;
  primary: boolean;
}

/** An error or warning shown as a card in the Quick Access corner (design: "Feedback and Errors"). */
export interface QuickAccessNotice {
  tone: "error" | "warning" | "info";
  /** A name the page maps to an icon: `triangle-alert`, `clipboard-x`, `keyboard`, `scan-line`, `trash`, `logo`. */
  icon: string;
  title: string;
  body: string;
  /** Keys drawn as keycaps under the text (the first-start hint). */
  keys: string[];
  actions: NoticeAction[];
}

/** One Quick Access card: the screenshot that was just taken. Mirrors `CardPayload` in src-tauri/src/quick_access. */
export interface QuickAccessCard {
  id: string;
  /** The style this card is drawn in right now (older cards of a large stack are compact). */
  style: QuickAccessStyle;
  /** Card width in CSS pixels (340 compact stack, 380 large stack). */
  width: number;
  /** 0 = never close by itself. */
  autoCloseSecs: number;
  /** URL of the thumbnail for an <img>. */
  thumbUrl: string;
  pixelWidth: number;
  pixelHeight: number;
  fileName: string;
  /** Folder as shown to the user, e.g. `Pictures/LumenGrab`. */
  folder: string;
  source: "Area" | "Window" | "Fullscreen";
  bytes: number;
  pad: CardPad;
  /** `bottom`: the stack is in a bottom corner, so hints go above the card instead of below it. */
  edge: "top" | "bottom";
  /** Present on notice cards: they show this instead of a screenshot. */
  notice?: QuickAccessNotice;
}

/** Where "Save as…" put the copy. */
export interface SavedCopy {
  folder: string;
  fileName: string;
}

/** What the native side knows about a document window's file. */
export interface DocumentInfo {
  fileName: string;
  /** The folder, as shown to the user. */
  folder: string;
}

export type SaveFormat = "png" | "lumengrab";

/** A place the user picked in a save dialog, good for one write (`writeGrantedFile`). */
export interface SaveTarget {
  token: string;
  folder: string;
  fileName: string;
  format: SaveFormat;
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
  /** The card this Quick Access window (`qa-1` ... `qa-3`) should show, if one is assigned to it. */
  getQuickAccessCard(slot: string): Promise<QuickAccessCard | null>;
  /** Calls `listener` whenever the card of this window changes (`null`: the window is free again). */
  onQuickAccessCard(
    slot: string,
    listener: (card: QuickAccessCard | null) => void,
  ): Promise<() => void>;
  /**
   * The card measured itself. `extraTop` / `extraBottom` ask for room around it for a tooltip or a
   * hint; the first call also shows the window.
   */
  quickAccessSize(id: string, height: number, extraTop: number, extraBottom: number): Promise<void>;
  quickAccessClose(id: string): Promise<void>;
  /** "Delete": the screenshot goes to the Trash when the card closes, unless `quickAccessUndoDelete` comes first. */
  quickAccessDelete(id: string): Promise<void>;
  quickAccessUndoDelete(id: string): Promise<void>;
  /** A button of a notice card was pressed. Rejects with a readable message if the action failed. */
  quickAccessNoticeAction(id: string, index: number): Promise<void>;
  /** Starts dragging the screenshot file out of the card (into a chat, a folder, a web page). */
  quickAccessDrag(id: string): Promise<void>;
  /** Calls `listener(true)` when a drag started from this card's window and `listener(false)` when it ended. */
  onQuickAccessDrag(slot: string, listener: (active: boolean) => void): Promise<() => void>;
  /** Copies the saved screenshot to the clipboard. */
  quickAccessCopy(id: string): Promise<void>;
  /** "Save as…": resolves to where the copy went, or `null` if the user cancelled. */
  quickAccessSaveAs(id: string): Promise<SavedCopy | null>;
  /** Shows the file in Finder / Explorer. */
  quickAccessReveal(id: string): Promise<void>;
  /** The file of this document window. A page never names a path: the native side knows it by window. */
  getDocumentInfo(label: string): Promise<DocumentInfo>;
  /** The bytes of this document window's file. */
  loadDocument(label: string): Promise<Uint8Array>;
  /** Shows the document's file in Finder / Explorer. */
  revealDocument(label: string): Promise<void>;
  /** Closes this document window. */
  closeDocument(label: string): Promise<void>;
  /** A save dialog. `null` if the user cancelled. */
  pickSaveTarget(options: {
    suggestedName: string;
    formats: SaveFormat[];
  }): Promise<SaveTarget | null>;
  /** Writes bytes (atomically) to a place `pickSaveTarget` granted. */
  writeGrantedFile(token: string, bytes: Uint8Array): Promise<void>;
  /** Opens the Releases page in the default browser (the only address the native side allows). */
  openUrl(url: string): Promise<void>;
  getSettingsInfo(): Promise<SettingsInfo>;
  openScreenshotsFolder(): Promise<void>;
  /** Whether the OS currently lets LumenGrab record the screen (always true on Windows). */
  getPermissionStatus(): Promise<boolean>;
  /** Asks the OS once and opens System Settings at Screen Recording. */
  openPermissionSettings(): Promise<void>;
  closePermissionWindow(): Promise<void>;
  quitApp(): Promise<void>;
  /** Quits and starts LumenGrab again (macOS applies a new permission only to new processes). */
  restartApp(): Promise<void>;
}

export class PlatformError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "PlatformError";
  }
}
