import { PlatformError } from "../types";
import type {
  AppInfo,
  DocumentInfo,
  CaptureMode,
  HistoryEntry,
  HistoryList,
  HistorySource,
  HistoryUsage,
  PinState,
  TextRecognition,
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
  UnsavedDocument,
  UpdateInfo,
  UpdateState,
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
    | "updateCheck"
    | "updateDownload"
    | "updateCancel"
    | "updateSkip"
    | "updateRestart"
    | "updateRestartConfirm"
    | "updateRestartDismiss"
    | "docCloseCancelled"
    | "presentReady"
    | "looksSave"
    | "shadersSave"
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
    | "restart"
    | "historyCopy"
    | "historyEdit"
    | "historyReveal"
    | "historySaveCopy"
    | "historyRemove"
    | "historyTrash"
    | "historyUndoTrash"
    | "historyClear"
    | "historyReset"
    | "historyOpenFolder"
    | "historyShow"
    | "openSettings"
    | "recognize"
    | "copyText"
    | "openLink"
    | "openLanguageSettings"
    | "pinHistory"
    | "pinQuickAccess"
    | "pinPng"
    | "pinZoom"
    | "pinResetSize"
    | "pinLock"
    | "pinClose"
    | "pinCopy"
    | "pinEdit"
    | "pinMenu"
    | "pinDrag";
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
      /** The last text the page put on the (fake) clipboard. */
      copiedText?: string;
      /** The pin window: picks an opacity like the native menu does. */
      chooseOpacity?: (percent: number) => void;
      /** Pretends the user closed the window while it has unsaved changes. */
      requestClose?: () => void;
      /** Tests can ask the open Settings window to show a page, as the tray does. */
      settingsPage?: (page: string) => void;
      /** The automatic look: a test sends a capture in, the page answers into `presented`. */
      present?: (
        id: number,
        picture: { width: number; height: number; rgba: Uint8ClampedArray },
      ) => void;
      presentInput?: Record<number, Uint8ClampedArray>;
      presented?: Record<
        number,
        { width: number; height: number; rgba: Uint8ClampedArray } | { error: string }
      >;
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

/** The demo history of this page load: `?history=12` (default), `0`, `off`, `broken`, `missing`. Newest first. */
let mockHistory: HistoryEntry[] | null = null;
let mockHistoryBroken: boolean | null = null;
const trashed: HistoryEntry[] = [];

function historyEntries(): HistoryEntry[] {
  if (mockHistory) return mockHistory;
  const q = new URLSearchParams(window.location.search).get("history") ?? "12";
  const count = Number.isNaN(Number(q)) ? (q === "empty" ? 0 : 12) : Number(q);
  const names = [
    "Screenshot_2026-10-25.png",
    "Checkout_error.png",
    "Invoice_Q3.png",
    "Settings_dialog.png",
    "Dashboard_full.png",
    "Screenshot_2026-10-24.png",
    "Login_flow.png",
    "Error_toast.png",
    "Roadmap_board.png",
    "Screenshot_2026-10-20.png",
    "Pricing_page.png",
    "Mockup_v2.png",
  ];
  const sources: HistorySource[] = [
    "area",
    "window",
    "area",
    "window",
    "fullscreen",
    "area",
    "allinone",
  ];
  const sizes: [number, number][] = [
    [1920, 1080],
    [2560, 1440],
    [1440, 900],
    [1280, 800],
    [3024, 1964],
    [1600, 1000],
  ];
  const day = 24 * 3_600_000;
  const now = Date.now();
  // Today: the first four, yesterday: the next four, then every day further back.
  const when = (i: number) =>
    i < 4 ? now - i * 2.5 * 3_600_000 : now - (Math.floor(i / 4) * day + (i % 4) * 3_600_000);
  mockHistory = Array.from({ length: Math.max(0, count) }, (_, i) => {
    const [width, height] = sizes[i % sizes.length] ?? [1920, 1080];
    return {
      id: `mock-${String(i + 1)}`,
      name: names[i % names.length] ?? `Capture ${String(i + 1)}.png`,
      capturedAt: when(i),
      width,
      height,
      bytes: 400_000 + i * 90_000,
      source: sources[i % sources.length] ?? "area",
      missing: q === "missing",
      pinned: i % 5 === 2,
    };
  });
  return mockHistory;
}

/** The pin window of this page: `?window=pin&percent=125&locked=1`. Moving between sizes mimics the real steps. */
const PIN_STEPS = [25, 33, 50, 67, 75, 80, 90, 100, 110, 125, 150, 175, 200, 250, 300, 400];
let mockPin: PinState | null = null;
const pinListeners = new Set<(state: PinState) => void>();
const pinedCards = new Set<string>();

function pinState(): PinState {
  if (mockPin) return mockPin;
  const q = new URLSearchParams(window.location.search);
  mockPin = {
    label: q.get("label") ?? "pin-1",
    name: "Screenshot_2026-10-25.png",
    percent: Number(q.get("percent") ?? "100"),
    locked: q.get("locked") === "1",
    inHistory: q.get("inhistory") !== "0",
  };
  return mockPin;
}

function setPin(patch: Partial<PinState>) {
  mockPin = { ...pinState(), ...patch };
  for (const listener of pinListeners) listener(mockPin);
}

/**
 * What reading a picture finds in the mock, by `?ocr=`: `empty`, `fail`, `nolang`, `qr` (with the text),
 * `qr-only`, `qr-two`, `slow` (a long read), or the default (six blocks, like the design). The boxes are
 * fractions of the picture, so any picture gets sensible ones.
 */
async function mockRecognition(width: number, height: number): Promise<TextRecognition> {
  const mode = new URLSearchParams(window.location.search).get("ocr") ?? "";
  if (mode === "slow") await sleep(2500);
  else await sleep(FAKE_LATENCY_MS);
  if (mode === "fail") throw new PlatformError("Text recognition failed.");
  if (mode === "nolang") {
    throw new PlatformError("No language pack for text recognition.", "no-language-pack");
  }
  const box = (text: string, fx: number, fy: number, fw: number, fh: number) => ({
    text,
    x: Math.round(fx * width),
    y: Math.round(fy * height),
    width: Math.round(fw * width),
    height: Math.round(fh * height),
  });
  const blocks =
    mode === "empty" || mode === "qr-only"
      ? []
      : [
          box("Checkout", 0.06, 0.07, 0.2, 0.05),
          box("anna.schmidt@example.com", 0.06, 0.2, 0.32, 0.04),
          box("4242 4242 4242 4242", 0.06, 0.3, 0.26, 0.04),
          box("DE89 3704 0044 0532 0130 00", 0.06, 0.4, 0.34, 0.04),
          box("Order summary\nPro plan $42.00\nTax $6.00", 0.56, 0.2, 0.28, 0.14),
          box("Total $48.00", 0.56, 0.42, 0.2, 0.04),
        ];
  const code = (value: string, fx: number, fy: number) => ({
    value,
    x: Math.round(fx * width),
    y: Math.round(fy * height),
    width: Math.round(0.12 * width),
    height: Math.round(0.12 * width),
  });
  const codes =
    mode === "qr" || mode === "qr-only"
      ? [code("https://lumengrab.app/docs/getting-started?ref=qr#install", 0.78, 0.7)]
      : mode === "qr-two"
        ? [
            code("https://lumengrab.app/docs/getting-started?ref=qr#install", 0.78, 0.7),
            code("WIFI:T:WPA;S:Office;P:secret;;", 0.6, 0.7),
          ]
        : [];
  const text = blocks.map((b) => b.text).join("\n");
  return { text, words: text.split(/\s+/).filter(Boolean).length, blocks, codes };
}

function pngSize(png: Uint8Array): { width: number; height: number } {
  const view = new DataView(png.buffer, png.byteOffset, png.byteLength);
  return { width: view.getUint32(16), height: view.getUint32(20) };
}

function historyBroken(): boolean {
  mockHistoryBroken ??= new URLSearchParams(window.location.search).get("history") === "broken";
  return mockHistoryBroken;
}

const SETTINGS_KEY = "lumengrab.mock.settings";
const LOOKS_KEY = "lumengrab.mock.looks";
const SHADERS_KEY = "lumengrab.mock.shaders";
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

// ---- updates: a small copy of the native state machine, driven by `?update=` and `?check=` -------------

const NOTES = [
  "### New",
  "- Presentation mode with looks, backgrounds and window frames",
  "- Layers panel: drag to reorder, hide, lock and rename",
  "### Improved",
  "- Capture overlay is faster on mixed-DPI displays",
  "### Fixed",
  "- Quick Access no longer closes while you drag a file out",
].join("\n");
const MB = 1024 * 1024;
const updateListeners = new Set<(info: UpdateInfo) => void>();
let updateInfo: UpdateInfo | null = null;

function initialUpdate(): UpdateInfo {
  const q = new URLSearchParams(window.location.search).get("update") ?? "idle";
  const now = new Date().toISOString();
  const available: UpdateState = {
    kind: "available",
    version: "0.5.0",
    notes: NOTES,
    date: "2026-10-12",
  };
  const states: Record<string, UpdateState> = {
    unavailable: { kind: "unavailable" },
    idle: { kind: "idle" },
    uptodate: { kind: "upToDate" },
    available,
    downloading: { kind: "downloading", version: "0.5.0", downloaded: 24 * MB, total: 38 * MB },
    ready: { kind: "ready", version: "0.5.0" },
    "failed-network": {
      kind: "failed",
      reason: "network",
      message: "network request failed (no connection)",
    },
    "failed-signature": { kind: "failed", reason: "signature", message: "signature did not match" },
    "failed-disk": { kind: "failed", reason: "disk", message: "no space left on device" },
  };
  return {
    state: states[q] ?? { kind: "idle" },
    currentVersion: "0.4.2",
    lastChecked: q === "idle" || q === "unavailable" ? null : now,
  };
}

function setUpdate(state: UpdateState, checked = false): void {
  const was = (updateInfo ??= initialUpdate());
  updateInfo = {
    ...was,
    state,
    lastChecked: checked ? new Date().toISOString() : was.lastChecked,
  };
  const info = updateInfo;
  updateListeners.forEach((listener) => {
    listener(info);
  });
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
    const wanted = query.get("mode");
    const mode: OverlayMode =
      wanted === "window" || wanted === "allinone" || wanted === "text" ? wanted : "area";
    // `?last=1280x720` is an area taken before: "repeat the last area" has something to repeat.
    const last = /^(\d+)x(\d+)$/.exec(query.get("last") ?? "");
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
      lastArea: last ? { width: Number(last[1]), height: Number(last[2]) } : null,
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

  async historyList(): Promise<HistoryList> {
    await sleep(FAKE_LATENCY_MS / 3);
    if (historyBroken())
      throw new PlatformError("The history can't be read: the history file is damaged.");
    return {
      entries: historyEntries().map((e) => ({ ...e })),
      off: new URLSearchParams(window.location.search).get("history") === "off",
    };
  },
  historyUsage(): Promise<HistoryUsage> {
    const entries = historyEntries();
    return Promise.resolve({
      count: entries.length,
      bytes: entries.reduce((sum, e) => sum + e.bytes, 0),
    });
  },
  historyThumbUrl(): string {
    return sampleCaptureUrl;
  },
  historyCopy(id: string): Promise<void> {
    record({ kind: "historyCopy", id });
    return new URLSearchParams(window.location.search).get("copy") === "fail"
      ? Promise.reject(new PlatformError("Another app is blocking the clipboard."))
      : Promise.resolve();
  },
  historyEdit(id: string): Promise<void> {
    record({ kind: "historyEdit", id });
    return Promise.resolve();
  },
  historyReveal(id: string): Promise<void> {
    record({ kind: "historyReveal", id });
    return Promise.resolve();
  },
  historyFileBytes(): Promise<Uint8Array> {
    return fetchSample();
  },
  historySaveCopy(id: string): Promise<string | null> {
    record({ kind: "historySaveCopy", id });
    return Promise.resolve(
      new URLSearchParams(window.location.search).get("cancel") === "1"
        ? null
        : "Documents/Reports",
    );
  },
  historyRemove(ids: string[]): Promise<void> {
    record({ kind: "historyRemove", ids });
    mockHistory = historyEntries().filter((e) => !ids.includes(e.id));
    return Promise.resolve();
  },
  /** Like the real one, the entries only leave the list; `historyUndoTrash` brings them back. */
  historyTrash(ids: string[]): Promise<void> {
    record({ kind: "historyTrash", ids });
    trashed.push(...historyEntries().filter((e) => ids.includes(e.id)));
    mockHistory = historyEntries().filter((e) => !ids.includes(e.id));
    return Promise.resolve();
  },
  historyUndoTrash(ids: string[]): Promise<void> {
    record({ kind: "historyUndoTrash", ids });
    const back = trashed.filter((e) => ids.includes(e.id));
    mockHistory = [...historyEntries(), ...back].sort((a, b) => b.capturedAt - a.capturedAt);
    return Promise.resolve();
  },
  historyClear(): Promise<void> {
    record({ kind: "historyClear" });
    mockHistory = [];
    return Promise.resolve();
  },
  historyReset(): Promise<void> {
    record({ kind: "historyReset" });
    mockHistoryBroken = false;
    mockHistory = [];
    return Promise.resolve();
  },
  historyReload(): Promise<void> {
    return historyBroken()
      ? Promise.reject(new PlatformError("The history can't be read: the history file is damaged."))
      : Promise.resolve();
  },
  historyOpenFolder(): Promise<void> {
    record({ kind: "historyOpenFolder" });
    return Promise.resolve();
  },
  recognizeText(png: Uint8Array): Promise<TextRecognition> {
    record({ kind: "recognize", size: png.length });
    const { width, height } = pngSize(png);
    return mockRecognition(width, height);
  },
  recognizeCardText(id: string): Promise<TextRecognition> {
    record({ kind: "recognize", id });
    return mockRecognition(1440, 900);
  },
  recognizeHistoryText(id: string): Promise<TextRecognition> {
    record({ kind: "recognize", id });
    return mockRecognition(1440, 900);
  },
  copyText(text: string): Promise<void> {
    record({ kind: "copyText", name: text });
    const log = (window.__lumengrabMock ??= { submissions: [] });
    log.copiedText = text;
    return new URLSearchParams(window.location.search).get("copy") === "fail"
      ? Promise.reject(new PlatformError("Another app is blocking the clipboard."))
      : Promise.resolve();
  },
  openLink(link: string): Promise<void> {
    record({ kind: "openLink", url: link });
    return Promise.resolve();
  },
  openLinkConfirmed(link: string): Promise<boolean> {
    record({ kind: "openLink", url: link });
    return Promise.resolve(new URLSearchParams(window.location.search).get("cancel") !== "1");
  },
  openLanguageSettings(): Promise<void> {
    record({ kind: "openLanguageSettings" });
    return Promise.resolve();
  },
  pinHistory(id: string): Promise<boolean> {
    record({ kind: "pinHistory", id });
    return Promise.resolve(new URLSearchParams(window.location.search).get("pinlimit") !== "1");
  },
  pinQuickAccess(id: string): Promise<boolean> {
    record({ kind: "pinQuickAccess", id });
    if (pinedCards.has(id)) {
      pinedCards.delete(id);
      return Promise.resolve(false);
    }
    pinedCards.add(id);
    return Promise.resolve(true);
  },
  quickAccessPinned(id: string): Promise<boolean> {
    return Promise.resolve(pinedCards.has(id));
  },
  pinPng(png: Uint8Array): Promise<boolean> {
    record({ kind: "pinPng", size: png.length });
    return Promise.resolve(true);
  },
  onPinsChanged(): Promise<() => void> {
    return Promise.resolve(() => undefined);
  },
  getPinState(): Promise<PinState | null> {
    return Promise.resolve(pinState());
  },
  onPinState(listener: (state: PinState) => void): Promise<() => void> {
    pinListeners.add(listener);
    return Promise.resolve(() => {
      pinListeners.delete(listener);
    });
  },
  onPinOpacity(listener: (percent: number) => void): Promise<() => void> {
    // Tests can choose an opacity like the native menu does.
    const on = (e: Event) => {
      listener((e as CustomEvent<number>).detail);
    };
    window.addEventListener("lumengrab-pin-opacity", on);
    const log = (window.__lumengrabMock ??= { submissions: [] });
    log.chooseOpacity = (percent: number) => {
      window.dispatchEvent(new CustomEvent("lumengrab-pin-opacity", { detail: percent }));
    };
    return Promise.resolve(() => {
      window.removeEventListener("lumengrab-pin-opacity", on);
    });
  },
  pinImageUrl(): string {
    return sampleCaptureUrl;
  },
  pinZoom(up: boolean): Promise<void> {
    record({ kind: "pinZoom", flag: up });
    const now = pinState().percent;
    const next = up
      ? (PIN_STEPS.find((p) => p > now) ?? 400)
      : ([...PIN_STEPS].reverse().find((p) => p < now) ?? 25);
    setPin({ percent: next });
    return Promise.resolve();
  },
  pinResetSize(): Promise<void> {
    record({ kind: "pinResetSize" });
    setPin({ percent: 100 });
    return Promise.resolve();
  },
  pinSetLocked(locked: boolean): Promise<void> {
    record({ kind: "pinLock", flag: locked });
    setPin({ locked });
    return Promise.resolve();
  },
  pinDrag(): Promise<void> {
    record({ kind: "pinDrag" });
    return Promise.resolve();
  },
  pinClose(): Promise<void> {
    record({ kind: "pinClose" });
    return Promise.resolve();
  },
  pinCopy(): Promise<void> {
    record({ kind: "pinCopy" });
    return new URLSearchParams(window.location.search).get("copy") === "fail"
      ? Promise.reject(new PlatformError("Another app is blocking the clipboard."))
      : Promise.resolve();
  },
  pinEdit(): Promise<void> {
    record({ kind: "pinEdit" });
    return Promise.resolve();
  },
  pinMenu(): Promise<void> {
    record({ kind: "pinMenu" });
    return Promise.resolve();
  },
  historyShow(): Promise<void> {
    record({ kind: "historyShow" });
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

  onSettingsPage(listener: (page: string) => void): Promise<() => void> {
    const log = (window.__lumengrabMock ??= { submissions: [] });
    log.settingsPage = listener;
    return Promise.resolve(() => {
      if (log.settingsPage === listener) delete log.settingsPage;
    });
  },

  getUpdateInfo(): Promise<UpdateInfo> {
    return Promise.resolve((updateInfo ??= initialUpdate()));
  },

  onUpdateInfo(listener: (info: UpdateInfo) => void): Promise<() => void> {
    updateListeners.add(listener);
    return Promise.resolve(() => {
      updateListeners.delete(listener);
    });
  },

  /** `?check=available|fail` decides what the check finds (default: nothing new). */
  async checkForUpdates(): Promise<UpdateInfo> {
    record({ kind: "updateCheck" });
    setUpdate({ kind: "checking" });
    await sleep(500);
    const outcome = new URLSearchParams(window.location.search).get("check") ?? "uptodate";
    if (outcome === "available") {
      setUpdate({ kind: "available", version: "0.5.0", notes: NOTES, date: "2026-10-12" }, true);
    } else if (outcome === "fail") {
      setUpdate({
        kind: "failed",
        reason: "network",
        message: "network request failed (no connection)",
      });
    } else setUpdate({ kind: "upToDate" }, true);
    return (updateInfo ??= initialUpdate());
  },

  /** The download runs for about two seconds, in steps. */
  downloadUpdate(): Promise<void> {
    record({ kind: "updateDownload" });
    let done = 0;
    setUpdate({ kind: "downloading", version: "0.5.0", downloaded: 0, total: 38 * MB });
    const timer = setInterval(() => {
      done += 4 * MB;
      if (done >= 38 * MB) {
        clearInterval(timer);
        setUpdate({ kind: "ready", version: "0.5.0" });
      } else if (updateInfo?.state.kind === "downloading") {
        setUpdate({ kind: "downloading", version: "0.5.0", downloaded: done, total: 38 * MB });
      } else clearInterval(timer);
    }, 200);
    return Promise.resolve();
  },

  cancelUpdate(): Promise<void> {
    record({ kind: "updateCancel" });
    setUpdate({ kind: "available", version: "0.5.0", notes: NOTES, date: "2026-10-12" });
    return Promise.resolve();
  },

  skipUpdate(): Promise<void> {
    record({ kind: "updateSkip" });
    setUpdate({ kind: "upToDate" });
    return Promise.resolve();
  },

  restartToUpdate(): Promise<void> {
    record({ kind: "updateRestart" });
    return Promise.resolve();
  },

  /** `?unsaved=2` lists two unsaved documents in the restart dialog. */
  getUnsavedDocuments(): Promise<UnsavedDocument[]> {
    const all: UnsavedDocument[] = [
      { label: "doc-1", name: "Screenshot_2026-10-14", kind: "capture" },
      { label: "doc-2", name: "Checkout_error", kind: "recovered" },
    ];
    const count = Number(new URLSearchParams(window.location.search).get("unsaved") ?? "2");
    return Promise.resolve(all.slice(0, count));
  },

  confirmUpdateRestart(): Promise<void> {
    record({ kind: "updateRestartConfirm" });
    return Promise.resolve();
  },

  dismissUpdateRestart(): Promise<void> {
    record({ kind: "updateRestartDismiss" });
    return Promise.resolve();
  },

  documentCloseCancelled(): Promise<void> {
    record({ kind: "docCloseCancelled" });
    return Promise.resolve();
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

  shadersLoad(name: "my-shaders" | "trusted"): Promise<string | null> {
    return Promise.resolve(window.localStorage.getItem(`${SHADERS_KEY}.${name}`));
  },

  shadersSave(name: "my-shaders" | "trusted", json: string): Promise<void> {
    record({ kind: "shadersSave" });
    window.localStorage.setItem(`${SHADERS_KEY}.${name}`, json);
    return Promise.resolve();
  },

  onShadersChanged(listener: () => void): Promise<() => void> {
    const handler = (e: StorageEvent) => {
      if (e.key?.startsWith(SHADERS_KEY)) listener();
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

  /** Tests trigger a request with `window.__lumengrabMock.present(id, picture)` and read the answer from `presented`. */
  onPresentRequest(
    listener: (request: { id: number; width: number; height: number }) => void,
  ): Promise<() => void> {
    const log = (window.__lumengrabMock ??= { submissions: [] });
    const send = (
      id: number,
      picture: { width: number; height: number; rgba: Uint8ClampedArray },
    ) => {
      (log.presentInput ??= {})[id] = picture.rgba;
      listener({ id, width: picture.width, height: picture.height });
    };
    log.present = send;
    return Promise.resolve(() => {
      if (log.present === send) delete log.present;
    });
  },

  presentTake(id: number): Promise<Uint8ClampedArray> {
    const rgba = window.__lumengrabMock?.presentInput?.[id];
    return rgba ? Promise.resolve(rgba) : Promise.reject(new PlatformError("No such request."));
  },

  presentResult(
    id: number,
    outcome: { width: number; height: number; rgba: Uint8ClampedArray } | { error: string },
  ): Promise<void> {
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
        { id: "text", keys: ["Ctrl", "Shift", "T"], registered: true },
        { id: "history", keys: ["Ctrl", "Shift", "H"], registered: true },
        { id: "pin", keys: ["Ctrl", "Shift", "P"], registered: true },
        { id: "unlock", keys: ["Ctrl", "Shift", "U"], registered: true },
      ],
    });
  },

  openSettings(page: string): Promise<void> {
    record({ kind: "openSettings", name: page });
    return Promise.resolve();
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

  getPermissionDiagnostics(): Promise<string> {
    return Promise.resolve(
      "LumenGrab 0.0.0\nmacOS: 15.0\nApp: /Applications/LumenGrab.app\nTranslocated: false\nSignature:\nIdentifier=app.lumengrab\nPreflight (CGPreflightScreenCaptureAccess): false",
    );
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
