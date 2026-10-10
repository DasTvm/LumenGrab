import { DesignSystemWindow } from "./DesignSystemWindow";
import { HomeWindow } from "./HomeWindow";
import { OverlayWindow } from "./OverlayWindow";
import { PermissionWindow } from "./PermissionWindow";
import { QuickAccessGallery } from "./QuickAccessGallery";
import { QuickAccessWindow } from "./QuickAccessWindow";
import { SettingsWindow } from "./SettingsWindow";

/** Picks the window to render from `?window=`. One frontend bundle serves every native window. */
export function App() {
  const windowName = new URLSearchParams(window.location.search).get("window");
  switch (windowName) {
    case "design":
      // Dev gallery only: not reachable in production builds.
      return import.meta.env.DEV ? <DesignSystemWindow /> : <HomeWindow />;
    case "quick-access-states":
      // Dev gallery only.
      return import.meta.env.DEV ? <QuickAccessGallery /> : <HomeWindow />;
    case "overlay":
      return <OverlayWindow />;
    case "quick":
      return <QuickAccessWindow />;
    case "permission":
      return <PermissionWindow />;
    case "settings":
      return <SettingsWindow />;
    default:
      return <HomeWindow />;
  }
}
