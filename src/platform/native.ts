import { getName, getVersion } from "@tauri-apps/api/app";
import { convertFileSrc, invoke } from "@tauri-apps/api/core";
import { currentOs } from "./os";
import {
  PlatformError,
  type AppInfo,
  type CaptureMode,
  type OverlaySession,
  type PixelRect,
  type SettingsInfo,
  type Platform,
} from "./types";

/** What the Rust command `capture_overlay_session` returns (see src-tauri/src/capture/commands.rs). */
type RawOverlaySession = Omit<OverlaySession, "frameUrl"> & { frameKey: string };

const SESSION_POLL_MS = 20;
const SESSION_TIMEOUT_MS = 5000;

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
    return { name, version, runtime: "native", os: currentOs() };
  },

  async startCapture(mode: CaptureMode): Promise<void> {
    await call("capture_start", { mode });
  },

  async getOverlaySession(sessionId: string, displayId: number): Promise<OverlaySession> {
    // The native side creates the overlay windows while it is still capturing the displays, so the
    // session may not exist yet: it answers `null` until it does.
    const deadline = Date.now() + SESSION_TIMEOUT_MS;
    for (;;) {
      const raw = await call<RawOverlaySession | null>("capture_overlay_session", {
        session: sessionId,
        display: displayId,
      });
      if (raw) {
        const { frameKey, ...session } = raw;
        // Served from memory by the Rust `lgcapture` URI scheme.
        return { ...session, frameUrl: convertFileSrc(frameKey, "lgcapture") };
      }
      if (Date.now() > deadline) throw new PlatformError("The capture took too long to start.");
      await new Promise<void>((resolve) => setTimeout(resolve, SESSION_POLL_MS));
    }
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

  getSettingsInfo(): Promise<SettingsInfo> {
    return call<SettingsInfo>("settings_info");
  },

  async openScreenshotsFolder(): Promise<void> {
    await call("open_screenshots_folder");
  },

  getPermissionStatus(): Promise<boolean> {
    return call<boolean>("permission_status");
  },

  async openPermissionSettings(): Promise<void> {
    await call("permission_open_settings");
  },

  async closePermissionWindow(): Promise<void> {
    await call("permission_close");
  },

  async restartApp(): Promise<void> {
    await call("restart_app");
  },
};
