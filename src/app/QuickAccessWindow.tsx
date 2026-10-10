import { useCallback, useEffect, useRef, useState } from "react";
import { platform, type QuickAccessCard } from "@/platform";
import {
  QuickAccessCardView,
  type StatusRow,
  type TipTarget,
} from "./quick-access/QuickAccessCard";

/** How long the Copy button shows "Copied". */
const COPIED_MS = 1800;
/** Hover time before a tooltip appears. */
const TIP_DELAY_MS = 350;
/** Room above the card for a tooltip: its height plus the gap to the card. */
const TIP_ROOM = 44;

function message(e: unknown, fallback: string): string {
  return e instanceof Error ? e.message : fallback;
}

/**
 * One Quick Access window (`?window=quick&slot=qa-1`). The native side puts a card into it (and
 * takes it out again); this draws it and runs everything that belongs to the card: the auto-close
 * timer, tooltips, Copy / Save as / Show and the status row.
 */
export function QuickAccessWindow() {
  const slot = new URLSearchParams(window.location.search).get("slot") ?? "qa-1";
  const [card, setCard] = useState<QuickAccessCard | null>(null);

  // The window itself must be see-through: only the card and its shadow are visible.
  useEffect(() => {
    document.documentElement.style.background = "transparent";
    document.body.style.background = "transparent";
  }, []);

  useEffect(() => {
    let off: (() => void) | undefined;
    let disposed = false;
    // Listen first, then ask: a card assigned in between is not missed.
    void platform
      .onQuickAccessCard(slot, setCard)
      .then((unlisten) => {
        if (disposed) unlisten();
        else off = unlisten;
        return platform.getQuickAccessCard(slot);
      })
      .then((current) => {
        if (current && !disposed) setCard((was) => was ?? current);
      });
    return () => {
      disposed = true;
      off?.();
    };
  }, [slot]);

  // A new card gets fresh state: the key is the card, not the window.
  return card ? <QuickAccessController key={card.id} card={card} /> : null;
}

function QuickAccessController({ card }: { card: QuickAccessCard }) {
  const [copied, setCopied] = useState(false);
  const [status, setStatus] = useState<StatusRow | null>(null);
  const [busy, setBusy] = useState(false);
  const [hovered, setHovered] = useState(false);
  const [tip, setTip] = useState<TipTarget | null>(null);
  const [thumbReady, setThumbReady] = useState(false);
  const cardRef = useRef<HTMLDivElement>(null);
  const tipTimer = useRef<number | undefined>(undefined);
  const copiedTimer = useRef<number | undefined>(undefined);
  const { id } = card;

  const close = useCallback(() => {
    void platform.quickAccessClose(id);
  }, [id]);

  const copy = useCallback(() => {
    setStatus(null);
    platform.quickAccessCopy(id).then(
      () => {
        setCopied(true);
        window.clearTimeout(copiedTimer.current);
        copiedTimer.current = window.setTimeout(() => {
          setCopied(false);
        }, COPIED_MS);
      },
      (e: unknown) => {
        setStatus({
          kind: "error",
          title: "Could not copy to the clipboard",
          detail: message(e, "Try again in a moment."),
          retry: "copy",
        });
      },
    );
  }, [id]);

  const saveAs = useCallback(() => {
    setBusy(true);
    setStatus(null);
    platform
      .quickAccessSaveAs(id)
      .then(
        (saved) => {
          if (saved) setStatus({ kind: "saved", ...saved });
        },
        (e: unknown) => {
          setStatus({
            kind: "error",
            title: "Could not save the screenshot",
            detail: message(e, "Try another folder."),
            retry: "save",
          });
        },
      )
      .finally(() => {
        setBusy(false);
      });
  }, [id]);

  // Keys work once the card has been clicked (it only takes the keyboard focus when clicked).
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.preventDefault();
        close();
      } else if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "c") {
        e.preventDefault();
        copy();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => {
      window.removeEventListener("keydown", onKey);
    };
  }, [close, copy]);

  // Tooltip: shown after a short hover. The "Copied" pill takes its place while it lasts.
  const showTip = useCallback((next: TipTarget | null) => {
    window.clearTimeout(tipTimer.current);
    if (next === null) {
      setTip(null);
      return;
    }
    tipTimer.current = window.setTimeout(() => {
      setTip(next);
    }, TIP_DELAY_MS);
  }, []);
  useEffect(
    () => () => {
      window.clearTimeout(tipTimer.current);
      window.clearTimeout(copiedTimer.current);
    },
    [],
  );
  const shownTip = copied ? "copied" : tip;

  // Tell the native side how tall the card is (and how much room a tooltip needs). The window is
  // shown by the first report, once the thumbnail is there, so it never flashes empty.
  const extraTop = shownTip ? TIP_ROOM : 0;
  useEffect(() => {
    const el = cardRef.current;
    if (!el || !thumbReady) return;
    let last = "";
    const report = () => {
      const height = el.offsetHeight;
      const key = `${String(height)}/${String(extraTop)}`;
      // A hidden page measures 0, and the same size twice is not news.
      if (height < 1 || key === last) return;
      last = key;
      void platform.quickAccessSize(id, height, extraTop, 0);
    };
    report();
    const observer = new ResizeObserver(report);
    observer.observe(el);
    return () => {
      observer.disconnect();
    };
  }, [id, thumbReady, extraTop, status]);

  // Hovering means being over the card itself, not over the transparent room around it.
  useEffect(() => {
    const el = cardRef.current;
    if (!el) return;
    const enter = () => {
      setHovered(true);
    };
    const leave = () => {
      setHovered(false);
    };
    el.addEventListener("pointerenter", enter);
    el.addEventListener("pointerleave", leave);
    return () => {
      el.removeEventListener("pointerenter", enter);
      el.removeEventListener("pointerleave", leave);
    };
  }, []);

  return (
    <>
      <QuickAccessCardView
        card={card}
        copied={copied}
        status={status}
        tip={shownTip}
        timer="running"
        paused={hovered || busy}
        cardRef={cardRef}
        onCopy={copy}
        onSave={saveAs}
        onClose={close}
        onReveal={() => {
          void platform.quickAccessReveal(id);
        }}
        onRetry={() => {
          if (status?.kind === "error" && status.retry === "save") saveAs();
          else copy();
        }}
        onTip={showTip}
        onExpire={close}
        onThumbLoaded={() => {
          setThumbReady(true);
        }}
      />
    </>
  );
}
