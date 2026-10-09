import type { Os } from "./types";

/** The OS the UI runs on, from the user agent (WKWebView on macOS, WebView2 on Windows). */
export function currentOs(): Os {
  if (typeof navigator === "undefined") return "other";
  const ua = navigator.userAgent;
  if (ua.includes("Mac")) return "macos";
  if (ua.includes("Windows")) return "windows";
  return "other";
}
