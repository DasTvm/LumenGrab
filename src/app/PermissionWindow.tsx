import { useCallback, useEffect, useState } from "react";
import { CheckCircle2, Lock } from "lucide-react";
import { platform } from "@/platform";
import { Badge } from "@/ui/components/badge";
import { Button } from "@/ui/components/button";
import { LogoMark } from "@/ui/components/logo-mark";
import { cn } from "@/ui/lib/utils";

const STEPS = [
  {
    title: "Open System Settings",
    description: "Privacy & Security → Screen & System Audio Recording",
  },
  { title: "Switch on LumenGrab", description: "Enable the toggle next to the app" },
  {
    title: "Quit and reopen LumenGrab",
    description: "macOS applies the permission only to apps that start afterwards",
  },
] as const;

type Check = "unknown" | "denied" | "granted";

/**
 * "Allow screen recording" (design: Onboarding Permission). Shown when a capture needs the macOS
 * Screen Recording permission. Re-checks when the window gets focus again, so coming back from
 * System Settings updates it. The extra help text covers builds whose identity changed (macOS
 * then shows the app as switched on but does not allow it).
 */
export function PermissionWindow() {
  const [check, setCheck] = useState<Check>("unknown");
  const [checking, setChecking] = useState(false);
  const [triedAgain, setTriedAgain] = useState(false);
  const [step, setStep] = useState(0);
  const [error, setError] = useState<string | null>(null);

  /** Reads the permission. Sets state only after the answer arrives. */
  const refresh = useCallback(async () => {
    try {
      const granted = await platform.getPermissionStatus();
      setCheck(granted ? "granted" : "denied");
    } catch (e) {
      setError(e instanceof Error ? e.message : "The permission could not be checked.");
    }
  }, []);

  // Initial check, and again whenever the window gets focus (coming back from System Settings).
  useEffect(() => {
    let alive = true;
    const check = () => {
      platform.getPermissionStatus().then(
        (granted) => {
          if (alive) setCheck(granted ? "granted" : "denied");
        },
        (e: unknown) => {
          if (alive)
            setError(e instanceof Error ? e.message : "The permission could not be checked.");
        },
      );
    };
    check();
    window.addEventListener("focus", check);
    return () => {
      alive = false;
      window.removeEventListener("focus", check);
    };
  }, []);

  const run = (action: () => Promise<void>) => {
    setError(null);
    action().catch((e: unknown) => {
      setError(e instanceof Error ? e.message : "That did not work.");
    });
  };

  const granted = check === "granted";

  return (
    <div className="flex h-screen bg-background text-foreground">
      <aside className="flex w-[340px] shrink-0 flex-col items-center justify-center gap-5 bg-panel p-8 text-panel-foreground">
        <LogoMark className="size-24" />
        <p className="font-brand text-3xl font-semibold">LumenGrab</p>
        <p className="text-base text-overlay-muted">Capture, polish, share. Free and private.</p>
      </aside>

      <main className="flex flex-1 flex-col justify-center gap-6 p-12">
        <header className="flex flex-col gap-2">
          <Badge variant="success" className="self-start">
            {granted ? "All set" : "One-time setup"}
          </Badge>
          <h1 className="text-2xl font-bold">
            {granted ? "Screen recording is on" : "Allow screen recording"}
          </h1>
          <p className="text-base text-muted-foreground">
            {granted
              ? "LumenGrab can capture your screen. If a capture still fails, restart LumenGrab once."
              : "macOS needs your permission before LumenGrab can capture the screen. Nothing ever leaves your Mac."}
          </p>
        </header>

        {granted ? (
          <div className="flex items-center gap-2.5 text-base font-medium">
            <CheckCircle2 className="size-5 text-success" aria-hidden />
            Permission granted
          </div>
        ) : (
          <ol className="flex flex-col gap-3.5">
            {STEPS.map((s, i) => (
              <li
                key={s.title}
                className="flex items-center gap-3.5"
                aria-current={i === step ? "step" : undefined}
              >
                <span
                  aria-hidden
                  className={cn(
                    "flex size-7 shrink-0 items-center justify-center rounded-full text-sm font-semibold",
                    i === step
                      ? "bg-brand text-brand-foreground"
                      : "bg-muted text-muted-foreground",
                  )}
                >
                  {i + 1}
                </span>
                <span className="flex flex-col gap-0.5">
                  <span className="text-base font-semibold">{s.title}</span>
                  <span className="text-sm text-muted-foreground">{s.description}</span>
                </span>
              </li>
            ))}
          </ol>
        )}

        <div className="flex items-center gap-2.5">
          {granted ? (
            <>
              <Button
                variant="accent"
                onClick={() => {
                  run(() => platform.closePermissionWindow());
                }}
              >
                Done
              </Button>
              <Button
                variant="outline"
                onClick={() => {
                  run(() => platform.restartApp());
                }}
              >
                Restart LumenGrab
              </Button>
            </>
          ) : (
            <>
              <Button
                variant="accent"
                onClick={() => {
                  setStep(1);
                  run(() => platform.openPermissionSettings());
                }}
              >
                Open System Settings
              </Button>
              <Button
                variant="outline"
                disabled={checking}
                onClick={() => {
                  setStep(2);
                  setChecking(true);
                  void refresh().finally(() => {
                    setChecking(false);
                    setTriedAgain(true);
                  });
                }}
              >
                Check again
              </Button>
            </>
          )}
        </div>

        <div aria-live="polite" className="flex flex-col gap-2 text-sm text-muted-foreground">
          {error ? (
            <p role="alert" className="text-destructive">
              {error}
            </p>
          ) : null}
          {!granted && triedAgain ? (
            <p data-testid="not-yet">
              Not allowed yet. Switch LumenGrab on in System Settings, then check again.
            </p>
          ) : null}
          {!granted ? (
            <p data-testid="stale-hint">
              Already switched on, but it still does not work? macOS ties the permission to this
              exact build of LumenGrab. Remove LumenGrab from the list with −, add it again with +,
              then{" "}
              <button
                type="button"
                className="font-medium text-foreground underline underline-offset-2 outline-none focus-visible:ring-2 focus-visible:ring-ring"
                onClick={() => {
                  run(() => platform.restartApp());
                }}
              >
                restart LumenGrab
              </button>
              .
            </p>
          ) : null}
        </div>

        <p className="flex items-center gap-2 text-xs text-muted-foreground">
          <Lock className="size-3.5" aria-hidden />
          No account, no telemetry, no cloud.
        </p>
      </main>
    </div>
  );
}
