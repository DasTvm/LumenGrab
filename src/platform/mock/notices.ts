import type { QuickAccessNotice } from "../types";

/** The notice cards of the design, for browser tests and the dev gallery (`?card=notice-save` ...). */
export const NOTICES: Record<string, QuickAccessNotice> = {
  "notice-save": {
    tone: "error",
    icon: "triangle-alert",
    title: "Could not save the screenshot",
    body: "The folder Pictures/LumenGrab is not writable. Choose another folder or try again.",
    keys: [],
    actions: [
      { label: "Retry", icon: "refresh", primary: true },
      { label: "Choose folder…", icon: "folder", primary: false },
    ],
  },
  "notice-clipboard": {
    tone: "error",
    icon: "clipboard-x",
    title: "Could not copy to the clipboard",
    body: "Another app is blocking the clipboard. Try again in a moment or save the file instead.",
    keys: [],
    actions: [
      { label: "Try again", icon: "refresh", primary: true },
      { label: "Save instead", icon: "download", primary: false },
    ],
  },
  "notice-shortcut": {
    tone: "warning",
    icon: "keyboard",
    title: "Ctrl+Shift+5 is already in use",
    body: "Another app has registered this shortcut, so “Capture Window” does not work from the keyboard. You can still start it from the menu bar icon.",
    keys: [],
    actions: [
      { label: "Open Settings", icon: "settings", primary: true },
      { label: "Dismiss", icon: "none", primary: false },
    ],
  },
  "notice-capture": {
    tone: "error",
    icon: "scan-line",
    title: "The capture did not work",
    body: "The screen could not be captured. This can happen while a display wakes up. Try again.",
    keys: [],
    actions: [
      { label: "Try again", icon: "refresh", primary: true },
      { label: "Copy details", icon: "copy", primary: false },
    ],
  },
  "notice-welcome": {
    tone: "info",
    icon: "logo",
    title: "LumenGrab is running",
    body: "It lives in the system tray. Press the shortcut below anytime to start a capture, from any app.",
    keys: ["Ctrl", "Shift", "1"],
    actions: [
      { label: "Open Settings", icon: "none", primary: false },
      { label: "Got it", icon: "none", primary: true },
    ],
  },
  "update-available": {
    tone: "update",
    icon: "refresh-cw",
    title: "LumenGrab 0.5.0 is here",
    body: "It downloads in the background and restarts when you choose.",
    keys: [],
    actions: [
      { label: "Install and restart", icon: "none", primary: true },
      { label: "Later", icon: "none", primary: false },
      { label: "See what's new", icon: "none", primary: false },
    ],
  },
  "update-downloading": {
    tone: "update",
    icon: "refresh-cw",
    title: "Downloading LumenGrab 0.5.0",
    body: "You can keep working. We'll tell you when it is ready.",
    progress: { fraction: 0.63, text: "24 of 38 MB · about 10 seconds left" },
    keys: [],
    actions: [{ label: "Cancel", icon: "none", primary: false }],
  },
  "update-ready": {
    tone: "update",
    icon: "refresh-cw",
    title: "A new version of LumenGrab is ready",
    body: "It installs in the background and restarts when you choose.",
    keys: [],
    actions: [
      { label: "Install and restart", icon: "none", primary: true },
      { label: "Later", icon: "none", primary: false },
    ],
  },
  "update-failed-signature": {
    tone: "error",
    icon: "triangle-alert",
    title: "Update failed: security check",
    body: "The update did not pass its signature check, so it was not installed. Your current version is untouched.",
    keys: [],
    actions: [
      { label: "Try again", icon: "none", primary: true },
      { label: "Download manually", icon: "none", primary: false },
    ],
  },
  "update-failed-network": {
    tone: "error",
    icon: "triangle-alert",
    title: "Update failed: no connection",
    body: "LumenGrab couldn't download the update. Check your internet connection and try again.",
    keys: [],
    actions: [
      { label: "Try again", icon: "none", primary: true },
      { label: "Later", icon: "none", primary: false },
    ],
  },
};
