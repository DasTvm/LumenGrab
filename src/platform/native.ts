import { getName, getVersion } from "@tauri-apps/api/app";
import { convertFileSrc, invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { currentOs } from "./os";
import {
  PlatformError,
  type AppInfo,
  type CaptureMode,
  type OverlayMode,
  type OverlaySession,
  type PixelRect,
  type QuickAccessCard,
  type SavedCopy,
  type Settings,
  type SettingsInfo,
  type Platform,
} from "./types";

/** What the Rust command `capture_overlay_session` returns (see src-tauri/src/capture/commands.rs). */
type RawQuickAccessCard = Omit<QuickAccessCard, "thumbUrl"> & { thumbKey: string };

const toCard = ({ thumbKey, ...card }: RawQuickAccessCard): QuickAccessCard => ({
  ...card,
  // Served from memory by the Rust `lgcapture` URI scheme.
  thumbUrl: convertFileSrc(thumbKey, "lgcapture"),
});

type RawOverlaySession = Omit<OverlaySession, "frameUrl"> & { frameKey: string };

const SESSION_TIMEOUT_MS = 8000;

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

  async startCapture(mode: CaptureMode, toolbar = false): Promise<void> {
    await call("capture_start", { mode, toolbar });
  },

  async getOverlaySession(sessionId: string, displayId: number): Promise<OverlaySession> {
    // The native side may still be capturing the displays, so the session may not exist yet: it
    // answers `null` until it does, and announces `capture-published` when it is there. No timer
    // polling: a hidden overlay window has its timers throttled by the web view.
    const fetchSession = () =>
      call<RawOverlaySession | null>("capture_overlay_session", {
        session: sessionId,
        display: displayId,
      });
    const toSession = ({ frameKey, ...session }: RawOverlaySession): OverlaySession =>
      // Served from memory by the Rust `lgcapture` URI scheme.
      ({ ...session, frameUrl: convertFileSrc(frameKey, "lgcapture") });

    return new Promise<OverlaySession>((resolve, reject) => {
      let unlisten: (() => void) | undefined;
      let finished = false;
      const finish = (done: () => void) => {
        if (finished) return;
        finished = true;
        clearTimeout(timeout);
        unlisten?.();
        done();
      };
      const attempt = () => {
        fetchSession().then(
          (raw) => {
            if (raw)
              finish(() => {
                resolve(toSession(raw));
              });
          },
          (err: unknown) => {
            finish(() => {
              reject(err instanceof Error ? err : new PlatformError("Capture failed."));
            });
          },
        );
      };
      const timeout = setTimeout(() => {
        finish(() => {
          reject(new PlatformError("The capture took too long to start."));
        });
      }, SESSION_TIMEOUT_MS);
      void listen<string>("capture-published", (event) => {
        if (event.payload === sessionId) attempt();
      }).then((off) => {
        if (finished) off();
        else unlisten = off;
        attempt(); // after listening, so a publish in between is not missed
      });
    });
  },

  async onOverlayAssignment(displayId, listener) {
    return listen<{ display: number; session: string | null }>("capture-overlay", (event) => {
      if (event.payload.display === displayId) listener(event.payload.session);
    });
  },

  getOverlayAssignment(): Promise<string | null> {
    return call<string | null>("capture_overlay_assignment");
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

  async setCaptureMode(sessionId: string, mode: OverlayMode): Promise<void> {
    await call("capture_set_mode", { session: sessionId, mode });
  },

  async onCaptureMode(sessionId, listener) {
    // Sent by Rust to all overlays of the capture whenever one of them switched the mode.
    return listen<{ session: string; mode: OverlayMode }>("capture-mode", (event) => {
      if (event.payload.session === sessionId) listener(event.payload.mode);
    });
  },

  async saveSettings(settings: Settings): Promise<void> {
    await call("settings_save", { settings });
  },

  async getQuickAccessCard(slot: string): Promise<QuickAccessCard | null> {
    const raw = await call<RawQuickAccessCard | null>("quick_access_card", { label: slot });
    return raw ? toCard(raw) : null;
  },

  async onQuickAccessCard(slot, listener) {
    // Sent by Rust whenever a card is added, restacked or removed. Every page hears every window's
    // updates, so each keeps only its own.
    return listen<{ label: string; card: RawQuickAccessCard | null }>("quick-access", (event) => {
      if (event.payload.label !== slot) return;
      listener(event.payload.card ? toCard(event.payload.card) : null);
    });
  },

  async quickAccessSize(id, height, extraTop, extraBottom) {
    await call("quick_access_size", { id, height, extraTop, extraBottom });
  },

  async quickAccessClose(id) {
    await call("quick_access_close", { id });
  },

  async quickAccessDrag(id) {
    await call("quick_access_drag", { id });
  },

  async onQuickAccessDrag(slot, listener) {
    return listen<{ label: string; active: boolean }>("quick-access-drag", (event) => {
      if (event.payload.label === slot) listener(event.payload.active);
    });
  },

  async quickAccessDelete(id) {
    await call("quick_access_delete", { id });
  },

  async quickAccessUndoDelete(id) {
    await call("quick_access_undo_delete", { id });
  },

  async quickAccessCopy(id) {
    await call("quick_access_copy", { id });
  },

  quickAccessSaveAs(id): Promise<SavedCopy | null> {
    return call<SavedCopy | null>("quick_access_save_as", { id });
  },

  async quickAccessReveal(id) {
    await call("quick_access_reveal", { id });
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
