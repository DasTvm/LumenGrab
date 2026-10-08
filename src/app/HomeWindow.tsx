import { useEffect, useState } from "react";
import { Crop, Monitor, SquareDashed } from "lucide-react";
import { platform, type AppInfo, type CaptureMode } from "@/platform";
import { Button } from "@/ui/components/button";

const ACTIONS: { mode: CaptureMode; label: string; hotkey: string; icon: typeof Crop }[] = [
  { mode: "area", label: "Capture area", hotkey: "Ctrl+Shift+4", icon: Crop },
  { mode: "window", label: "Capture window", hotkey: "Ctrl+Shift+5", icon: SquareDashed },
  { mode: "fullscreen", label: "Capture fullscreen", hotkey: "Ctrl+Shift+3", icon: Monitor },
];

/** Dev/demo screen for browser mock mode. The native app has no main window: it lives in the tray. */
export function HomeWindow() {
  const [info, setInfo] = useState<AppInfo | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [started, setStarted] = useState<CaptureMode | null>(null);

  useEffect(() => {
    platform.getAppInfo().then(setInfo, () => {
      setInfo(null);
    });
  }, []);

  const start = (mode: CaptureMode) => {
    setError(null);
    setStarted(null);
    platform.startCapture(mode).then(
      () => {
        setStarted(mode);
      },
      (err: unknown) => {
        setError(err instanceof Error ? err.message : "Capture failed.");
      },
    );
  };

  return (
    <main className="mx-auto flex min-h-screen max-w-3xl flex-col gap-6 p-8">
      <header>
        <h1 className="text-xl font-semibold">LumenGrab</h1>
        <p className="text-muted-foreground text-sm" data-testid="runtime">
          {info ? `${info.version} · ${info.runtime}` : "…"}
        </p>
      </header>

      <div className="flex flex-wrap gap-3">
        {ACTIONS.map(({ mode, label, hotkey, icon: Icon }) => (
          <Button
            key={mode}
            variant={mode === "area" ? "default" : "outline"}
            onClick={() => {
              start(mode);
            }}
          >
            <Icon />
            {label}
            <kbd className="text-xs opacity-70">{hotkey}</kbd>
          </Button>
        ))}
      </div>

      {error ? (
        <p role="alert" className="text-destructive text-sm">
          {error}
        </p>
      ) : null}

      <div className="border-border bg-secondary text-muted-foreground flex h-48 items-center justify-center rounded-lg border border-dashed px-6 text-center text-sm">
        {started === "fullscreen"
          ? "Fullscreen capture requested. In the app it is saved to Pictures/LumenGrab and copied to the clipboard."
          : "In the app, use the hotkeys or the menu bar icon. In the browser, these buttons open the capture overlay with a sample image."}
      </div>
    </main>
  );
}
