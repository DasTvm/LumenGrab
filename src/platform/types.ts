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
  tone: "error" | "warning" | "info" | "update";
  /** A name the page maps to an icon: `triangle-alert`, `clipboard-x`, `keyboard`, `scan-line`, `trash`, `logo`, `refresh-cw`. */
  icon: string;
  title: string;
  body: string;
  /** A progress bar under the text (the update download); `fraction` is `null` while the size is not known. */
  progress?: { fraction: number | null; text: string };
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

/** What the native side knows about a document window's file. */
export interface DocumentInfo {
  fileName: string;
  /** The folder, as shown to the user. */
  folder: string;
  /**
   * `file`: a `.lumengrab` on disk (Save writes to it). `capture`: a screenshot opened for editing, not
   * a document yet (the first Save asks where). `recovered`: unsaved work from the last session.
   */
  kind: "file" | "capture" | "recovered";
  /** The screenshot is a kept original (from before the automatic look): put the default look on as a presentation. */
  applyLook?: boolean;
}

export type SaveFormat = "png" | "jpg" | "webp" | "lumengrab";

/** Work the editor's autosave left behind (design: Recover unsaved work). */
export interface Recoverable {
  id: string;
  name: string;
  /** Milliseconds since 1970 when the copy was last written. */
  modifiedMs: number;
  bytes: number;
}

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
  presentation: {
    /** Put the default look on every new screenshot. */
    auto: boolean;
    /** A new capture opens in the Presentation tab of the editor. */
    openInPresentation: boolean;
  };
  updates: {
    /** Look for a new version once a day, in the background. Off: LumenGrab never goes online by itself. */
    auto: boolean;
  };
  /** The Windows first-start hint was shown. */
  seenIntro: boolean;
}

/** Why an update failed, as far as a person can act on it. */
export type UpdateFailReason = "network" | "signature" | "disk" | "other";

/** The one state of the updater (docs/adr/0008), the same in Settings, the Quick Access cards and the tray menu. */
export type UpdateState =
  /** Not set up in this build (no public key): the controls are hidden. */
  | { kind: "unavailable" }
  | { kind: "idle" }
  | { kind: "checking" }
  | { kind: "upToDate" }
  | {
      kind: "available";
      version: string;
      /** The release notes of the release page (Markdown). */
      notes: string | null;
      /** `YYYY-MM-DD`. */
      date: string | null;
    }
  | { kind: "downloading"; version: string; downloaded: number; total: number | null }
  | { kind: "ready"; version: string }
  | { kind: "failed"; reason: UpdateFailReason; message: string };

/** A document window with unsaved changes (the update restart lists them). */
export interface UnsavedDocument {
  label: string;
  name: string;
  kind: "file" | "capture" | "recovered";
}

export interface UpdateInfo {
  state: UpdateState;
  currentVersion: string;
  /** The last check that worked (RFC 3339, UTC). */
  lastChecked: string | null;
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
  /** The bytes of the card's screenshot file (the PNG as saved). "Save as…" builds its file from them. */
  quickAccessFileBytes(id: string): Promise<Uint8Array>;
  /** Shows a file that `writeGrantedFile` wrote (by its save token) in Finder / Explorer. */
  revealSavedFile(token: string): Promise<void>;
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
  /** Calls `listener` when the app asks this Settings window to show a page (the tray's "Check for Updates…"). */
  onSettingsPage(listener: (page: string) => void): Promise<() => void>;
  /** The state of the updater and what is known around it. */
  getUpdateInfo(): Promise<UpdateInfo>;
  /** Calls `listener` whenever the state changes (also for changes another window made). */
  onUpdateInfo(listener: (info: UpdateInfo) => void): Promise<() => void>;
  /** Looks for a new version now. */
  checkForUpdates(): Promise<UpdateInfo>;
  /** Downloads the available update in the background; progress arrives through `onUpdateInfo`. */
  downloadUpdate(): Promise<void>;
  cancelUpdate(): Promise<void>;
  /** Do not announce this version again automatically. */
  skipUpdate(): Promise<void>;
  /** Installs the downloaded update and restarts the app (after asking about unsaved documents). */
  restartToUpdate(): Promise<void>;
  /** The documents with unsaved changes (the restart dialog lists them). */
  getUnsavedDocuments(): Promise<UnsavedDocument[]>;
  /** "Install and restart" in the dialog: each unsaved document asks "Save changes?", then the update is installed. */
  confirmUpdateRestart(): Promise<void>;
  /** "Later" in the dialog. */
  dismissUpdateRestart(): Promise<void>;
  /** The user cancelled "Save changes?" of a document: an update restart waiting for it is off. */
  documentCloseCancelled(): Promise<void>;
  /** A dialog to pick a picture (PNG, JPEG or WebP, up to 20 MB) for a background: its bytes, or `null` if cancelled. */
  pickImage(): Promise<Uint8Array | null>;
  /** The text of `looks.json` (the user's saved looks), or `null` if there is none yet. */
  looksLoad(): Promise<string | null>;
  /** Writes `looks.json` (atomically) and tells the other windows. */
  looksSave(json: string): Promise<void>;
  /** A background picture of a look by its asset name, or `null` if it is not there. */
  looksReadAsset(name: string): Promise<Uint8Array | null>;
  looksWriteAsset(name: string, bytes: Uint8Array): Promise<void>;
  /** Deletes the pictures of looks that are not in `keep`. */
  looksPruneAssets(keep: string[]): Promise<void>;
  /** Calls `listener` when another window changed the looks. */
  onLooksChanged(listener: () => void): Promise<() => void>;
  /** The hidden page of the automatic look listens: the native side may send requests. */
  presentReady(): Promise<void>;
  /** Calls `listener` with a new request: a capture (its size; the pixels come from `presentTake`) to put the default look on. */
  onPresentRequest(
    listener: (request: { id: number; width: number; height: number }) => void,
  ): Promise<() => void>;
  /** The pixels (RGBA, straight alpha) a request is about. */
  presentTake(id: number): Promise<Uint8ClampedArray>;
  /** Answers a request with the finished picture (RGBA), or with the reason it failed. */
  presentResult(
    id: number,
    outcome: { width: number; height: number; rgba: Uint8ClampedArray } | { error: string },
  ): Promise<void>;
  /** Writes bytes (atomically) to a place `pickSaveTarget` granted. */
  writeGrantedFile(token: string, bytes: Uint8Array): Promise<void>;
  /** Saves the document to the `.lumengrab` file its window was opened from (atomically). */
  saveDocument(label: string, bytes: Uint8Array): Promise<void>;
  /** After a Save As of an untitled document: the window is that file from now on (`token` of the write). */
  bindSavedDocument(label: string, token: string): Promise<void>;
  /** Tells the native side whether the window has unsaved changes (closing it then asks first). */
  setDocumentDirty(label: string, dirty: boolean): Promise<void>;
  /** Calls `listener` when the user tries to close this window while it has unsaved changes. */
  onDocumentCloseRequested(label: string, listener: () => void): Promise<() => void>;
  /**
   * Encodes RGBA pixels as lossy WebP (quality 1-100). The WebView of macOS cannot do it, so the native
   * side does; the editor uses this only when the WebView cannot.
   */
  encodeWebp(
    rgba: Uint8ClampedArray,
    width: number,
    height: number,
    quality: number,
  ): Promise<Uint8Array>;
  /** The font families installed on this device, sorted (the text tool's "installed fonts"). */
  listSystemFonts(): Promise<string[]>;
  /** Puts a PNG on the clipboard. */
  copyPngToClipboard(png: Uint8Array): Promise<void>;
  /** "Edit" on a Quick Access card: opens the screenshot in the editor. */
  quickAccessEdit(id: string): Promise<void>;
  /** Writes the recovery copy of a document (`id` = its document id). */
  recoveryWrite(id: string, bytes: Uint8Array, name: string): Promise<void>;
  recoveryList(): Promise<Recoverable[]>;
  recoveryRead(id: string): Promise<Uint8Array>;
  recoveryDelete(ids: string[]): Promise<void>;
  /** Opens the chosen recovery copies in editor windows and closes the recovery window. */
  recoveryOpen(ids: string[]): Promise<void>;
  closeRecoveryWindow(): Promise<void>;
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
