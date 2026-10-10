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
};
