import { useEffect, useState } from "react";
import { Camera } from "lucide-react";
import { platform, type AppInfo, type CaptureResult } from "@/platform";
import { Button } from "@/ui/components/button";

/** M0 demo screen: proves the platform layer works in the browser mock and in the native app. */
export function HomeWindow() {
  const [info, setInfo] = useState<AppInfo | null>(null);
  const [capture, setCapture] = useState<CaptureResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    platform.getAppInfo().then(setInfo, () => {
      setInfo(null);
    });
  }, []);

  const runCapture = () => {
    setBusy(true);
    setError(null);
    platform
      .capture("fullscreen")
      .then(setCapture)
      .catch((err: unknown) => {
        setError(err instanceof Error ? err.message : "Capture failed.");
      })
      .finally(() => {
        setBusy(false);
      });
  };

  return (
    <main className="mx-auto flex min-h-screen max-w-3xl flex-col gap-6 p-8">
      <header className="flex items-center justify-between gap-4">
        <div>
          <h1 className="text-xl font-semibold">LumenGrab</h1>
          <p className="text-muted-foreground text-sm" data-testid="runtime">
            {info ? `${info.version} · ${info.runtime}` : "…"}
          </p>
        </div>
        <Button onClick={runCapture} disabled={busy}>
          <Camera />
          {busy ? "Capturing…" : "Capture"}
        </Button>
      </header>

      {error ? (
        <p role="alert" className="text-destructive text-sm">
          {error}
        </p>
      ) : null}

      {capture ? (
        <img
          src={capture.imageUrl}
          alt="Captured screen"
          width={capture.width}
          height={capture.height}
          className="border-border bg-surface w-full rounded-lg border"
        />
      ) : (
        <div className="border-border bg-surface text-muted-foreground flex h-64 items-center justify-center rounded-lg border border-dashed text-sm">
          No capture yet. Press Capture.
        </div>
      )}
    </main>
  );
}
