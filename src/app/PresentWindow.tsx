import { useEffect } from "react";
import { platform } from "@/platform";
import { renderDefaultLook } from "@/presentation/auto-look";
import { looksStore } from "@/editor/ui/presentation/looks-instance";

/**
 * The hidden page behind the automatic look (`?window=present`, docs/adr/0007): it waits for the native
 * side to hand it a capture, draws the default look on it and answers with the finished PNG. It has no
 * interface. Any failure is reported, never swallowed, so the capture can be delivered as it was.
 */
export function PresentWindow() {
  useEffect(() => {
    let stop: (() => void) | null = null;
    const life = { alive: true };
    void (async () => {
      await looksStore.getState().init();
      const off = await platform.onPresentRequest((id) => {
        void (async () => {
          try {
            const png = await platform.presentTake(id);
            const look = looksStore.getState().defaultLook;
            const finished = await renderDefaultLook(png, look, (name) =>
              looksStore.getState().readAsset(name),
            );
            await platform.presentResult(id, { png: finished });
          } catch (e) {
            await platform
              .presentResult(id, { error: e instanceof Error ? e.message : "The look failed." })
              .catch(() => undefined);
          }
        })();
      });
      if (!life.alive) {
        off();
        return;
      }
      stop = off;
      await platform.presentReady();
    })();
    return () => {
      life.alive = false;
      stop?.();
    };
  }, []);
  return null;
}
