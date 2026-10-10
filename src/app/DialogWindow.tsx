import { MonitorOff } from "lucide-react";
import { platform } from "@/platform";
import { Button } from "@/ui/components/button";

/**
 * Small blocking dialogs (`?window=dialog&kind=...`). Only one so far: macOS turned Screen Recording
 * off while LumenGrab was running (design: Feedback and Errors, 04).
 */
export function DialogWindow() {
  const kind = new URLSearchParams(window.location.search).get("kind");
  if (kind !== "permission-lost") {
    return (
      <main className="p-7 text-sm text-destructive" role="alert">
        Unknown dialog.
      </main>
    );
  }
  return (
    <main className="flex h-screen flex-col justify-between gap-[18px] bg-background p-7 text-foreground">
      <div className="flex flex-col gap-[18px]">
        <div className="flex items-center gap-3.5">
          <span className="flex size-11 shrink-0 items-center justify-center rounded-xl bg-destructive/10 text-destructive">
            <MonitorOff aria-hidden className="size-[22px]" />
          </span>
          <h1 className="text-lg font-semibold">Screen Recording is turned off</h1>
        </div>
        <p className="text-sm leading-normal text-muted-foreground">
          macOS stopped LumenGrab from capturing the screen. Turn it back on in System Settings,
          then reopen LumenGrab. Your captures are safe.
        </p>
      </div>
      <div className="flex justify-end gap-2">
        <Button
          variant="outline"
          onClick={() => {
            void platform.quitApp();
          }}
        >
          Quit LumenGrab
        </Button>
        <Button
          variant="accent"
          autoFocus
          onClick={() => {
            void platform.openPermissionSettings();
          }}
        >
          Open System Settings
        </Button>
      </div>
    </main>
  );
}
