import { HomeWindow } from "./HomeWindow";
import { SettingsWindow } from "./SettingsWindow";

/** Picks the window to render from `?window=`. One frontend bundle serves every native window. */
export function App() {
  const windowName = new URLSearchParams(window.location.search).get("window");
  switch (windowName) {
    case "settings":
      return <SettingsWindow />;
    default:
      return <HomeWindow />;
  }
}
