import { type AppInfo, type CaptureResult, type Platform } from "../types";
import sampleCaptureUrl from "./sample-capture.png?url";

const SAMPLE = { width: 1440, height: 900, scale: 2 } as const;
const FAKE_LATENCY_MS = 150;

const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

/** Browser implementation: no native calls, returns a bundled sample image as the "capture". */
export const mockPlatform: Platform = {
  getAppInfo(): Promise<AppInfo> {
    return Promise.resolve({ name: "LumenGrab", version: "0.1.0-mock", runtime: "browser-mock" });
  },

  // Any capture mode returns the same sample; the parameter is intentionally omitted.
  async capture(): Promise<CaptureResult> {
    await sleep(FAKE_LATENCY_MS);
    return { imageUrl: sampleCaptureUrl, ...SAMPLE };
  },
};
