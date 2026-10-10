import type { Settings } from "./types";

/** The same defaults as `Settings::default()` in src-tauri/src/settings.rs (shown until the real ones load, and used by the browser mock). */
export const DEFAULT_SETTINGS: Settings = {
  defaultMode: "area",
  copyToClipboard: true,
  quickAccess: { enabled: true, style: "compact", autoCloseSecs: 5, corner: "bottomRight" },
  seenIntro: false,
};
