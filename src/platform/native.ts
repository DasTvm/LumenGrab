import { getName, getVersion } from "@tauri-apps/api/app";
import {
  PlatformError,
  type AppInfo,
  type CaptureMode,
  type CaptureResult,
  type Platform,
} from "./types";

/** Tauri-backed implementation. Every Tauri command gets a typed wrapper here (no raw invoke() in the UI). */
export const nativePlatform: Platform = {
  async getAppInfo(): Promise<AppInfo> {
    const [name, version] = await Promise.all([getName(), getVersion()]);
    return { name, version, runtime: "native" };
  },

  capture(mode: CaptureMode): Promise<CaptureResult> {
    return Promise.reject(new PlatformError(`Capture (${mode}) is not available yet.`));
  },
};
