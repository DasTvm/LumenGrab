import { PlatformError } from "../types";
import type {
  AppInfo,
  CaptureMode,
  OverlayMode,
  OverlaySession,
  OverlayWindowInfo,
  PixelRect,
  QuickAccessCard,
  SavedCopy,
  Platform,
  Settings,
  SettingsInfo,
} from "../types";
import { DEFAULT_SETTINGS } from "../defaults";
import { currentOs } from "../os";
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
    | "quit"
    | "qaUndoDelete"
    | "qaSaveAs"
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
  extraTop?: number;
  extraBottom?: number;
}

declare global {
  interface Window {
    __lumengrabMock?: { submissions: MockSubmission[] };
  }
}

function record(entry: MockSubmission): void {
  const log = (window.__lumengrabMock ??= { submissions: [] });
  log.submissions.push(entry);
}

const SETTINGS_KEY = "lumengrab.mock.settings";

function storedSettings(): Settings {
  try {
    const raw = window.localStorage.getItem(SETTINGS_KEY);
    const saved = raw ? (JSON.parse(raw) as Partial<Settings>) : {};
    return {
      ...DEFAULT_SETTINGS,
      ...saved,
      quickAccess: { ...DEFAULT_SETTINGS.quickAccess, ...saved.quickAccess },
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

  /** `?saveas=cancel` makes the dialog "cancelled". */
  quickAccessSaveAs(id: string): Promise<SavedCopy | null> {
    record({ kind: "qaSaveAs", id });
    return Promise.resolve(
      new URLSearchParams(window.location.search).get("saveas") === "cancel"
        ? null
        : { folder: "Documents/Reports", fileName: "Q3 numbers.png" },
    );
  },

  quickAccessReveal(id: string): Promise<void> {
    record({ kind: "qaReveal", id });
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
