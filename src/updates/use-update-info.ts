import { useEffect, useState } from "react";
import { platform, type UpdateInfo } from "@/platform";

/** The updater's state plus when it arrived and when the current download began (for "about 10 seconds left"). */
export interface UpdateView extends UpdateInfo {
  updatedAt: number;
  downloadStartedAt: number | null;
}

/** The state of the updater, live: read once, then every change from any window. */
export function useUpdateInfo(): UpdateView | null {
  const [view, setView] = useState<UpdateView | null>(null);
  useEffect(() => {
    let stop: (() => void) | null = null;
    const life = { alive: true };
    const take = (info: UpdateInfo) => {
      if (!life.alive) return;
      const at = Date.now();
      setView((was) => ({
        ...info,
        updatedAt: at,
        downloadStartedAt:
          info.state.kind === "downloading" ? (was?.downloadStartedAt ?? at) : null,
      }));
    };
    void (async () => {
      const off = await platform.onUpdateInfo(take);
      if (!life.alive) {
        off();
        return;
      }
      stop = off;
      const first = await platform.getUpdateInfo();
      setView((was) => {
        if (was || !life.alive) return was;
        const at = Date.now();
        return {
          ...first,
          updatedAt: at,
          downloadStartedAt: first.state.kind === "downloading" ? at : null,
        };
      });
    })();
    return () => {
      life.alive = false;
      stop?.();
    };
  }, []);
  return view;
}
