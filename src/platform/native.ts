import { getName, getVersion } from "@tauri-apps/api/app";
import { convertFileSrc, invoke } from "@tauri-apps/api/core";
import {
  PlatformError,
  type AppInfo,
  type CaptureMode,
  type OverlaySession,
  type PixelRect,
  type Platform,
} from "./types";

/** What the Rust command `capture_overlay_session` returns (see src-tauri/src/capture/commands.rs). */
type RawOverlaySession = Omit<OverlaySession, "frameUrl"> & { frameKey: string };

/** Rust returns errors as plain strings; surface them as PlatformError. */
async function call<T>(command: string, args?: Record<string, unknown>): Promise<T> {
  try {
    return await invoke<T>(command, args);
  } catch (err) {
    throw new PlatformError(typeof err === "string" ? err : "The operation failed.");
  }
}

/** Tauri-backed implementation. Every Tauri command gets a typed wrapper here (no raw invoke() in the UI). */
export const nativePlatform: Platform = {
  async getAppInfo(): Promise<AppInfo> {
    const [name, version] = await Promise.all([getName(), getVersion()]);
    return { name, version, runtime: "native" };
  },

  async startCapture(mode: CaptureMode): Promise<void> {
    await call("capture_start", { mode });
  },

  async getOverlaySession(sessionId: string, displayId: number): Promise<OverlaySession> {
    const { frameKey, ...session } = await call<RawOverlaySession>("capture_overlay_session", {
      session: sessionId,
      display: displayId,
    });
    // Served from memory by the Rust `lgcapture` URI scheme.
    return { ...session, frameUrl: convertFileSrc(frameKey, "lgcapture") };
  },

  async overlayReady(sessionId: string, displayId: number): Promise<void> {
    await call("capture_overlay_ready", { session: sessionId, display: displayId });
  },

  async submitArea(sessionId: string, displayId: number, rect: PixelRect): Promise<void> {
    await call("capture_submit_area", { session: sessionId, display: displayId, rect });
  },

  async submitWindow(sessionId: string, windowId: number): Promise<void> {
    await call("capture_submit_window", { session: sessionId, windowId });
  },

  async cancelCapture(sessionId: string): Promise<void> {
    await call("capture_cancel", { session: sessionId });
  },
};
