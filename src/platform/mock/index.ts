import { PlatformError } from "../types";
import type {
  AppInfo,
  DocumentInfo,
  CaptureMode,
  Recoverable,
  OverlayMode,
  OverlaySession,
  OverlayWindowInfo,
  PixelRect,
  QuickAccessCard,
  Platform,
  Settings,
  SaveFormat,
  SaveTarget,
  SettingsInfo,
} from "../types";
import { DEFAULT_SETTINGS } from "../defaults";
import { currentOs } from "../os";
import { buildScenario } from "./documents";
import { NOTICES } from "./notices";
import sampleCaptureUrl from "./sample-capture.png?url";

/** Size of the bundled sample image: the "frozen frame" in mock mode. */
const FRAME = { width: 1440, height: 900, scale: 2 } as const;
const FAKE_LATENCY_MS = 150;

/** Fake windows in frame pixels, front to back, matching the sample image (a window with a chart card on top). */
const MOCK_WINDOWS: OverlayWindowInfo[] = [
  {
    id: 101,
    title: "Quarterly report",
    appName: "Sheets",
    x: 424,
    y: 360,
    width: 842,
    height: 370,
  },
  { id: 102, title: "Dashboard", appName: "Browser", x: 120, y: 90, width: 1200, height: 720 },
];

/** Everything the mock was asked to do, so browser tests can assert on it. */
export interface MockSubmission {
  kind:
    | "area"
    | "window"
    | "cancel"
    | "start"
    | "qaSize"
    | "qaClose"
    | "qaCopy"
    | "qaDelete"
    | "qaDrag"
    | "qaNotice"
    | "docReveal"
    | "docClose"
    | "docSave"
    | "docBind"
    | "docDirty"
    | "copyPng"
    | "encodeWebp"
    | "qaEdit"
    | "recoveryWrite"
    | "recoveryDelete"
    | "recoveryOpen"
    | "recoveryClose"
    | "pickSave"
    | "pickImage"
    | "presentReady"
    | "looksSave"
    | "writeFile"
    | "openUrl"
    | "quit"
    | "qaUndoDelete"
    | "qaFileBytes"
    | "revealSaved"
    | "qaReveal"
    | "mode"
    | "settings"
    | "openFolder"
    | "openPermissionSettings"
    | "closePermission"
    | "restart";
  sessionId?: string;
  displayId?: number;
  rect?: PixelRect;
  windowId?: number;
  mode?: CaptureMode;
  settings?: Settings;
  id?: string;
  height?: number;
  index?: number;
  url?: string;
  name?: string;
  formats?: string[];
  size?: number;
  extraTop?: number;
  extraBottom?: number;
  /** `docDirty`: the flag that was sent. */
  flag?: boolean;
  ids?: string[];
}

declare global {
  interface Window {
    /** `written`: the bytes a save wrote, by save token, for browser tests. */
    __lumengrabMock?: {
      submissions: MockSubmission[];
      written?: Record<string, Uint8Array>;
      /** The last bytes `saveDocument` wrote, by window label. */
      saved?: Record<string, Uint8Array>;
      /** The PNG the copy button put on the (fake) clipboard. */
      copied?: Uint8Array;
      /** Recovery copies the editor wrote, by document id. */
      recovery?: Record<string, { bytes: Uint8Array; name: string }>;
      /** Pretends the user closed the window while it has unsaved changes. */
      requestClose?: () => void;
      /** The automatic look: a test sends a capture in, the page answers into `presented`. */
      present?: (id: number, png: Uint8Array) => void;
      presentInput?: Record<number, Uint8Array>;
      presented?: Record<number, { png: Uint8Array } | { error: string }>;
    };
  }
}

function record(entry: MockSubmission): void {
  const log = (window.__lumengrabMock ??= { submissions: [] });
  log.submissions.push(entry);
}

async function fetchSample(): Promise<Uint8Array> {
  return new Uint8Array(await (await fetch(sampleCaptureUrl)).arrayBuffer());
}

const SETTINGS_KEY = "lumengrab.mock.settings";
const LOOKS_KEY = "lumengrab.mock.looks";
/** The background pictures of saved looks (the real app keeps them as files; the mock only for this page load). */
const lookAssets = new Map<string, Uint8Array>();

function storedSettings(): Settings {
  try {
    const raw = window.localStorage.getItem(SETTINGS_KEY);
    const saved = raw ? (JSON.parse(raw) as Partial<Settings>) : {};
    return {
      ...DEFAULT_SETTINGS,
      ...saved,
      quickAccess: { ...DEFAULT_SETTINGS.quickAccess, ...saved.quickAccess },
      presentation: { ...DEFAULT_SETTINGS.presentation, ...saved.presentation },
    };
  } catch {
    return DEFAULT_SETTINGS;
  }
}

const modeChannel = (): BroadcastChannel | null =>
  typeof BroadcastChannel === "undefined" ? null : new BroadcastChannel("lumengrab-mock-mode");

const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

/** Browser implementation: no native calls, uses a bundled sample image as the frozen frame. */
export const mockPlatform: Platform = {
  getAppInfo(): Promise<AppInfo> {
    return Promise.resolve({
      name: "LumenGrab",
      version: "0.1.0-mock",
      runtime: "browser-mock",
      os: currentOs(),
    });
  },

  async startCapture(mode: CaptureMode, toolbar = false): Promise<void> {
    record({ kind: "start", mode });
    await sleep(FAKE_LATENCY_MS);
    if (mode !== "fullscreen") {
      // In the app the overlay opens in its own windows; in the browser we navigate to it.
      window.location.assign(
        `/?window=overlay&session=mock&display=1&mode=${mode}${toolbar ? "&toolbar=1" : ""}`,
      );
    }
  },

  async getOverlaySession(_sessionId: string, displayId: number): Promise<OverlaySession> {
    const query = new URLSearchParams(window.location.search);
    const mode = query.get("mode") === "window" ? "window" : "area";
    await sleep(0);
    return {
      mode,
      // `?toolbar=1` is the main shortcut; `?home=0` is a second display, which stays clean.
      toolbar: query.get("toolbar") === "1",
      home: query.get("home") !== "0",
      display: {
        id: displayId,
        name: "Mock display",
        pixelWidth: FRAME.width,
        pixelHeight: FRAME.height,
        scale: FRAME.scale,
      },
      frameUrl: sampleCaptureUrl,
      windows: MOCK_WINDOWS,
    };
  },

  // The browser mock opens an overlay with its session in the URL; nothing is ever assigned.
  onOverlayAssignment(): Promise<() => void> {
    return Promise.resolve(() => undefined);
  },

  getOverlayAssignment(): Promise<string | null> {
    return Promise.resolve(null);
  },

  overlayReady(): Promise<void> {
    return Promise.resolve();
  },

  submitArea(sessionId: string, displayId: number, rect: PixelRect): Promise<void> {
    record({ kind: "area", sessionId, displayId, rect });
    return Promise.resolve();
  },

  submitWindow(sessionId: string, windowId: number): Promise<void> {
    record({ kind: "window", sessionId, windowId });
    return Promise.resolve();
  },

  cancelCapture(sessionId: string): Promise<void> {
    record({ kind: "cancel", sessionId });
    return Promise.resolve();
  },

  setCaptureMode(_sessionId: string, mode: OverlayMode): Promise<void> {
    record({ kind: "mode", mode });
    // Two browser tabs of the same browser stand in for two displays.
    const channel = modeChannel();
    channel?.postMessage(mode);
    channel?.close();
    return Promise.resolve();
  },

  onCaptureMode(_sessionId: string, listener: (mode: OverlayMode) => void): Promise<() => void> {
    const channel = modeChannel();
    const onMessage = (e: MessageEvent<OverlayMode>) => {
      listener(e.data);
    };
    channel?.addEventListener("message", onMessage);
    return Promise.resolve(() => {
      channel?.removeEventListener("message", onMessage);
      channel?.close();
    });
  },

  saveSettings(settings: Settings): Promise<void> {
    record({ kind: "settings", settings });
    try {
      window.localStorage.setItem(SETTINGS_KEY, JSON.stringify(settings));
    } catch {
      // storage unavailable: the choice just does not persist
    }
    return Promise.resolve();
  },

  /** `?card=large&secs=1&bytes=1234567`: a demo card for browser tests and the dev gallery. */
  getQuickAccessCard(): Promise<QuickAccessCard | null> {
    const q = new URLSearchParams(window.location.search);
    if (q.get("window") !== "quick" || q.get("card") === "none") return Promise.resolve(null);
    const large = q.get("card") === "large";
    const notice = NOTICES[q.get("card") ?? ""];
    if (notice) {
      return Promise.resolve({
        id: "demo",
        style: "compact",
        width: notice.tone === "info" ? 380 : 480,
        autoCloseSecs: 0,
        thumbUrl: "",
        pixelWidth: 0,
        pixelHeight: 0,
        fileName: "",
        folder: "",
        source: "Area",
        bytes: 0,
        pad: { top: 8, right: 24, bottom: 24, left: 24 },
        edge: "bottom",
        notice,
      });
    }
    return Promise.resolve({
      id: "demo",
      style: large ? "large" : "compact",
      width: large ? 380 : 340,
      autoCloseSecs: Number(q.get("secs") ?? 5),
      thumbUrl: sampleCaptureUrl,
      pixelWidth: 1920,
      pixelHeight: 1080,
      fileName: "Screenshot 2026-10-09 at 14.02.png",
      folder: "Pictures/LumenGrab",
      source: "Area",
      bytes: Number(q.get("bytes") ?? 1_234_567),
      pad: { top: 8, right: 24, bottom: 24, left: 24 },
      edge: "bottom",
    });
  },

  onQuickAccessCard(): Promise<() => void> {
    return Promise.resolve(() => undefined);
  },

  quickAccessSize(
    id: string,
    height: number,
    extraTop: number,
    extraBottom: number,
  ): Promise<void> {
    record({ kind: "qaSize", id, height, extraTop, extraBottom });
    return Promise.resolve();
  },

  quickAccessClose(id: string): Promise<void> {
    record({ kind: "qaClose", id });
    return Promise.resolve();
  },

  /** `?notice=fail` makes the action fail, to show the error on the card. */
  quickAccessNoticeAction(id: string, index: number): Promise<void> {
    record({ kind: "qaNotice", id, index });
    return new URLSearchParams(window.location.search).get("notice") === "fail"
      ? Promise.reject(new PlatformError("The folder is still not writable."))
      : Promise.resolve();
  },

  quickAccessDrag(id: string): Promise<void> {
    record({ kind: "qaDrag", id });
    return Promise.resolve();
  },

  onQuickAccessDrag(): Promise<() => void> {
    return Promise.resolve(() => undefined);
  },

  quickAccessDelete(id: string): Promise<void> {
    record({ kind: "qaDelete", id });
    return Promise.resolve();
  },

  quickAccessUndoDelete(id: string): Promise<void> {
    record({ kind: "qaUndoDelete", id });
    return Promise.resolve();
  },

  quickAccessCopy(id: string): Promise<void> {
    record({ kind: "qaCopy", id });
    return new URLSearchParams(window.location.search).get("copy") === "fail"
      ? Promise.reject(new PlatformError("Another app is blocking the clipboard."))
      : Promise.resolve();
  },

  /** The demo card's screenshot: the bundled sample picture. */
  async quickAccessFileBytes(id: string): Promise<Uint8Array> {
    record({ kind: "qaFileBytes", id });
    return fetchSample();
  },

  revealSavedFile(token: string): Promise<void> {
    record({ kind: "revealSaved", id: token });
    return Promise.resolve();
  },

  quickAccessReveal(id: string): Promise<void> {
    record({ kind: "qaReveal", id });
    return Promise.resolve();
  },

  /** `?kind=capture|recovered` makes it an unsaved document; the default is a saved file. `&applylook=1`: a kept original. */
  getDocumentInfo(): Promise<DocumentInfo> {
    const q = new URLSearchParams(window.location.search);
    const kind = q.get("kind");
    if (kind === "capture") {
      return Promise.resolve({
        fileName: "Screenshot 2026-10-09 at 14.02",
        folder: "Pictures/LumenGrab",
        kind: "capture",
        ...(q.get("applylook") === "1" ? { applyLook: true } : {}),
      });
    }
    return Promise.resolve({
      fileName:
        kind === "recovered" ? "Checkout_error" : "Screenshot 2026-10-09 at 14.02.lumengrab",
      folder: "Pictures/LumenGrab",
      kind: kind === "recovered" ? "recovered" : "file",
    });
  },

  /** `?scenario=ready|redactions|annotated|readonly|corrupt|truncated|warnings` picks the document. */
  loadDocument(): Promise<Uint8Array> {
    const q = new URLSearchParams(window.location.search);
    if (q.get("kind") === "capture") return fetchSample();
    return buildScenario(q.get("scenario") ?? "ready");
  },

  revealDocument(): Promise<void> {
    record({ kind: "docReveal" });
    return Promise.resolve();
  },

  closeDocument(): Promise<void> {
    record({ kind: "docClose" });
    return Promise.resolve();
  },

  /** `?cancel=1` cancels the dialog; `?saveformat=lumengrab` picks that format. */
  pickSaveTarget(options: {
    suggestedName: string;
    formats: SaveFormat[];
  }): Promise<SaveTarget | null> {
    record({ kind: "pickSave", name: options.suggestedName, formats: options.formats });
    const q = new URLSearchParams(window.location.search);
    if (q.get("cancel") === "1") return Promise.resolve(null);
    const wanted = q.get("saveformat");
    const format = options.formats.find((f) => f === wanted) ?? options.formats[0] ?? "png";
    const base = options.suggestedName.replace(/\.[^.]+$/, "");
    return Promise.resolve({
      token: "t1",
      folder: "Documents/Reports",
      fileName: `${base}.${format}`,
      format,
    });
  },

  /** A 96 x 64 test picture (pink to orange); `?cancel=1` cancels the dialog. */
  async pickImage(): Promise<Uint8Array | null> {
    record({ kind: "pickImage" });
    if (new URLSearchParams(window.location.search).get("cancel") === "1") return null;
    const canvas = new OffscreenCanvas(96, 64);
    const ctx = canvas.getContext("2d");
    if (!ctx) return null;
    const g = ctx.createLinearGradient(0, 0, 96, 64);
    g.addColorStop(0, "#ec4899");
    g.addColorStop(1, "#f97316");
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, 96, 64);
    return new Uint8Array(await (await canvas.convertToBlob({ type: "image/png" })).arrayBuffer());
  },

  looksLoad(): Promise<string | null> {
    return Promise.resolve(window.localStorage.getItem(LOOKS_KEY));
  },

  looksSave(json: string): Promise<void> {
    record({ kind: "looksSave" });
    if (new URLSearchParams(window.location.search).get("looksfail") === "1")
      return Promise.reject(new PlatformError("The folder is not writable."));
    window.localStorage.setItem(LOOKS_KEY, json);
    return Promise.resolve();
  },

  looksReadAsset(name: string): Promise<Uint8Array | null> {
    return Promise.resolve(lookAssets.get(name) ?? null);
  },

  looksWriteAsset(name: string, bytes: Uint8Array): Promise<void> {
    lookAssets.set(name, bytes);
    return Promise.resolve();
  },

  looksPruneAssets(keep: string[]): Promise<void> {
    for (const name of [...lookAssets.keys()]) if (!keep.includes(name)) lookAssets.delete(name);
    return Promise.resolve();
  },

  /** Another tab of the browser changing the looks is the closest thing to another window. */
  onLooksChanged(listener: () => void): Promise<() => void> {
    const handler = (e: StorageEvent) => {
      if (e.key === LOOKS_KEY) listener();
    };
    window.addEventListener("storage", handler);
    return Promise.resolve(() => {
      window.removeEventListener("storage", handler);
    });
  },

  presentReady(): Promise<void> {
    record({ kind: "presentReady" });
    return Promise.resolve();
  },

  /** Tests trigger a request with `window.__lumengrabMock.present(id, png)` and read the answer from `presented`. */
  onPresentRequest(listener: (id: number) => void): Promise<() => void> {
    const log = (window.__lumengrabMock ??= { submissions: [] });
    const send = (id: number, png: Uint8Array) => {
      (log.presentInput ??= {})[id] = png;
      listener(id);
    };
    log.present = send;
    return Promise.resolve(() => {
      if (log.present === send) delete log.present;
    });
  },

  presentTake(id: number): Promise<Uint8Array> {
    const png = window.__lumengrabMock?.presentInput?.[id];
    return png ? Promise.resolve(png) : Promise.reject(new PlatformError("No such request."));
  },

  presentResult(id: number, outcome: { png: Uint8Array } | { error: string }): Promise<void> {
    const log = (window.__lumengrabMock ??= { submissions: [] });
    (log.presented ??= {})[id] = outcome;
    return Promise.resolve();
  },

  writeGrantedFile(token: string, bytes: Uint8Array): Promise<void> {
    record({ kind: "writeFile", id: token, size: bytes.length });
    const log = (window.__lumengrabMock ??= { submissions: [] });
    (log.written ??= {})[token] = bytes;
    return new URLSearchParams(window.location.search).get("writefail") === "1"
      ? Promise.reject(new PlatformError("The folder is not writable."))
      : Promise.resolve();
  },

  /** `?savefail=1` makes saving fail with a disk-full message. */
  saveDocument(label: string, bytes: Uint8Array): Promise<void> {
    record({ kind: "docSave", id: label, size: bytes.length });
    if (new URLSearchParams(window.location.search).get("savefail") === "1") {
      return Promise.reject(new PlatformError("no space left on device (os error 28)"));
    }
    const log = (window.__lumengrabMock ??= { submissions: [] });
    (log.saved ??= {})[label] = bytes;
    return Promise.resolve();
  },

  bindSavedDocument(label: string, token: string): Promise<void> {
    record({ kind: "docBind", id: label, name: token });
    return Promise.resolve();
  },

  setDocumentDirty(label: string, dirty: boolean): Promise<void> {
    record({ kind: "docDirty", id: label, flag: dirty });
    return Promise.resolve();
  },

  onDocumentCloseRequested(_label: string, listener: () => void): Promise<() => void> {
    const log = (window.__lumengrabMock ??= { submissions: [] });
    log.requestClose = listener;
    return Promise.resolve(() => {
      if (log.requestClose === listener) delete log.requestClose;
    });
  },

  /** The mock runs in a browser engine that encodes WebP itself; this is the same thing through the canvas. */
  async encodeWebp(
    rgba: Uint8ClampedArray,
    width: number,
    height: number,
    quality: number,
  ): Promise<Uint8Array> {
    record({ kind: "encodeWebp", size: rgba.length });
    const canvas = new OffscreenCanvas(width, height);
    const ctx = canvas.getContext("2d");
    if (!ctx) throw new PlatformError("No canvas.");
    ctx.putImageData(new ImageData(new Uint8ClampedArray(rgba), width, height), 0, 0);
    const blob = await canvas.convertToBlob({ type: "image/webp", quality: quality / 100 });
    return new Uint8Array(await blob.arrayBuffer());
  },

  /** A few families, like a Mac has; `?fonts=none` pretends there are none (a device without the font). */
  listSystemFonts(): Promise<string[]> {
    if (new URLSearchParams(window.location.search).get("fonts") === "none")
      return Promise.resolve([]);
    return Promise.resolve([
      "American Typewriter",
      "Arial",
      "Avenir Next",
      "Courier New",
      "Futura",
      "Georgia",
      "Helvetica Neue",
      "Menlo",
      "Optima",
      "Palatino",
      "Times New Roman",
      "Trebuchet MS",
    ]);
  },

  copyPngToClipboard(png: Uint8Array): Promise<void> {
    record({ kind: "copyPng", size: png.length });
    const log = (window.__lumengrabMock ??= { submissions: [] });
    log.copied = png;
    return new URLSearchParams(window.location.search).get("copyfail") === "1"
      ? Promise.reject(new PlatformError("The clipboard is not available."))
      : Promise.resolve();
  },

  quickAccessEdit(id: string): Promise<void> {
    record({ kind: "qaEdit", id });
    return Promise.resolve();
  },

  recoveryWrite(id: string, bytes: Uint8Array, name: string): Promise<void> {
    record({ kind: "recoveryWrite", id, size: bytes.length, name });
    const log = (window.__lumengrabMock ??= { submissions: [] });
    (log.recovery ??= {})[id] = { bytes, name };
    return Promise.resolve();
  },

  /** `?recoverable=2` offers two unsaved documents; saved ones from this page's autosave are listed too. */
  async recoveryList(): Promise<Recoverable[]> {
    const log = (window.__lumengrabMock ??= { submissions: [] });
    const wanted = Number(new URLSearchParams(window.location.search).get("recoverable") ?? "0");
    const store = (log.recovery ??= {});
    const names = ["Screenshot_2026-10-08", "Checkout_error", "Screenshot_2026-10-07"];
    for (let i = 0; i < wanted; i += 1) {
      const id = `recovered-${String(i + 1)}`;
      if (!store[id]) {
        store[id] = {
          bytes: await buildScenario(i === 1 ? "redactions" : i === 0 ? "stack" : "ready"),
          name: names[i] ?? `Capture ${String(i + 1)}`,
        };
      }
    }
    return Object.entries(store).map(([id, v], i) => ({
      id,
      name: v.name,
      modifiedMs: Date.now() - (i + 1) * 3_600_000,
      bytes: v.bytes.length,
    }));
  },

  recoveryRead(id: string): Promise<Uint8Array> {
    const entry = window.__lumengrabMock?.recovery?.[id];
    return entry
      ? Promise.resolve(entry.bytes)
      : Promise.reject(new PlatformError("The recovery copy is gone."));
  },

  recoveryDelete(ids: string[]): Promise<void> {
    record({ kind: "recoveryDelete", ids });
    for (const id of ids) delete window.__lumengrabMock?.recovery?.[id];
    return Promise.resolve();
  },

  recoveryOpen(ids: string[]): Promise<void> {
    record({ kind: "recoveryOpen", ids });
    return Promise.resolve();
  },

  closeRecoveryWindow(): Promise<void> {
    record({ kind: "recoveryClose" });
    return Promise.resolve();
  },

  openUrl(url: string): Promise<void> {
    record({ kind: "openUrl", url });
    return Promise.resolve();
  },

  getSettingsInfo(): Promise<SettingsInfo> {
    return Promise.resolve({
      saveDir: "~/Pictures/LumenGrab",
      settings: storedSettings(),
      hotkeys: [
        { id: "capture", keys: ["Ctrl", "Shift", "1"], registered: true },
        { id: "area", keys: ["Ctrl", "Shift", "4"], registered: true },
        { id: "window", keys: ["Ctrl", "Shift", "5"], registered: true },
        { id: "fullscreen", keys: ["Ctrl", "Shift", "3"], registered: true },
      ],
    });
  },

  openScreenshotsFolder(): Promise<void> {
    record({ kind: "openFolder" });
    return Promise.resolve();
  },

  /** `?granted=1` makes the mock report the permission as granted. */
  getPermissionStatus(): Promise<boolean> {
    return Promise.resolve(new URLSearchParams(window.location.search).get("granted") === "1");
  },

  openPermissionSettings(): Promise<void> {
    record({ kind: "openPermissionSettings" });
    return Promise.resolve();
  },

  closePermissionWindow(): Promise<void> {
    record({ kind: "closePermission" });
    return Promise.resolve();
  },

  quitApp(): Promise<void> {
    record({ kind: "quit" });
    return Promise.resolve();
  },

  restartApp(): Promise<void> {
    record({ kind: "restart" });
    return Promise.resolve();
  },
};
