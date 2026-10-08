import type {
  AppInfo,
  CaptureMode,
  OverlaySession,
  OverlayWindowInfo,
  PixelRect,
  Platform,
} from "../types";
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
  kind: "area" | "window" | "cancel" | "start";
  sessionId?: string;
  displayId?: number;
  rect?: PixelRect;
  windowId?: number;
  mode?: CaptureMode;
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

const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

/** Browser implementation: no native calls, uses a bundled sample image as the frozen frame. */
export const mockPlatform: Platform = {
  getAppInfo(): Promise<AppInfo> {
    return Promise.resolve({ name: "LumenGrab", version: "0.1.0-mock", runtime: "browser-mock" });
  },

  async startCapture(mode: CaptureMode): Promise<void> {
    record({ kind: "start", mode });
    await sleep(FAKE_LATENCY_MS);
    if (mode !== "fullscreen") {
      // In the app the overlay opens in its own windows; in the browser we navigate to it.
      window.location.assign(`/?window=overlay&session=mock&display=1&mode=${mode}`);
    }
  },

  async getOverlaySession(_sessionId: string, displayId: number): Promise<OverlaySession> {
    const mode =
      new URLSearchParams(window.location.search).get("mode") === "window" ? "window" : "area";
    await sleep(0);
    return {
      mode,
      display: {
        id: displayId,
        name: "Mock display",
        pixelWidth: FRAME.width,
        pixelHeight: FRAME.height,
        scale: FRAME.scale,
      },
      frameUrl: sampleCaptureUrl,
      windows: mode === "window" ? MOCK_WINDOWS : [],
    };
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
};
