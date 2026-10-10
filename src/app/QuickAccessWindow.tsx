import { useCallback, useEffect, useRef, useState } from "react";
import { platform, type QuickAccessCard } from "@/platform";
import { NoticeCardView } from "./quick-access/NoticeCard";
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
/** Room below the card for the "Drag to a chat or folder" hint. */
const HINT_ROOM = 44;
/** How long Undo is offered after Delete. The file only goes to the Trash when this has run out. */
const UNDO_SECS = 6;

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
  if (!card) return null;
  return card.notice ? (
    <NoticeController key={card.id} card={{ ...card, notice: card.notice }} />
  ) : (
    <QuickAccessController key={card.id} card={card} slot={slot} />
  );
}

/** A notice card: it stays until the user deals with it (a button, Close or Esc). */
function NoticeController({
  card,
}: {
  card: QuickAccessCard & { notice: NonNullable<QuickAccessCard["notice"]> };
}) {
  const { id } = card;
  const [cardEl, setCardEl] = useState<HTMLDivElement | null>(null);
  const [busy, setBusy] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);

  const close = useCallback(() => {
    void platform.quickAccessClose(id);
  }, [id]);

  const act = useCallback(
    (index: number) => {
      setBusy(index);
      setError(null);
      platform
        .quickAccessNoticeAction(id, index)
        .catch((e: unknown) => {
          setError(message(e, "That did not work."));
        })
        .finally(() => {
          setBusy(null);
        });
    },
    [id],
  );

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") close();
    };
    window.addEventListener("keydown", onKey);
    return () => {
      window.removeEventListener("keydown", onKey);
    };
  }, [close]);

  // The first report shows the window.
  useEffect(() => {
    if (!cardEl) return;
    let last = 0;
    const report = () => {
      const height = cardEl.offsetHeight;
      if (height < 1 || height === last) return;
      last = height;
      void platform.quickAccessSize(id, height, 0, 0);
    };
    report();
    const observer = new ResizeObserver(report);
    observer.observe(cardEl);
    return () => {
      observer.disconnect();
    };
  }, [id, cardEl, error]);

  return (
    <NoticeCardView
      card={card}
      busy={busy}
      error={error}
      onAction={act}
      onClose={close}
      onCardElement={setCardEl}
    />
  );
}

function QuickAccessController({ card, slot }: { card: QuickAccessCard; slot: string }) {
  const [copied, setCopied] = useState(false);
  const [status, setStatus] = useState<StatusRow | null>(null);
  const [deleted, setDeleted] = useState(false);
  const [dragging, setDragging] = useState(false);
  const [busy, setBusy] = useState(false);
  const [hovered, setHovered] = useState(false);
  const [tip, setTip] = useState<TipTarget | null>(null);
  const [thumbReady, setThumbReady] = useState(false);
  const [cardEl, setCardEl] = useState<HTMLDivElement | null>(null);
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

  const remove = useCallback(() => {
    setStatus(null);
    setCopied(false);
    platform.quickAccessDelete(id).then(
      () => {
        setDeleted(true);
      },
      (e: unknown) => {
        setStatus({
          kind: "error",
          title: "Could not delete the screenshot",
          detail: message(e, "It may already be gone."),
          retry: "copy",
        });
      },
    );
  }, [id]);

  const undo = useCallback(() => {
    platform.quickAccessUndoDelete(id).then(
      () => {
        setDeleted(false);
      },
      () => {
        close(); // it is already gone: nothing left to bring back
      },
    );
  }, [id, close]);

  // The native side tells when the drag out of this window starts and ends.
  useEffect(() => {
    let off: (() => void) | undefined;
    let disposed = false;
    const onDrag = (active: boolean) => {
      setDragging(active);
      // The pointer events of the drag went to the OS: do not stay "hovered" (timer paused) after it.
      if (!active) setHovered(false);
    };
    void platform.onQuickAccessDrag(slot, onDrag).then((unlisten) => {
      if (disposed) unlisten();
      else off = unlisten;
    });
    return () => {
      disposed = true;
      off?.();
    };
  }, [slot]);

  const startDrag = useCallback(() => {
    platform.quickAccessDrag(id).catch((e: unknown) => {
      setStatus({
        kind: "error",
        title: "Could not start the drag",
        detail: message(e, "Use Save as… instead."),
        retry: "save",
      });
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
  // The compact card says "Copied" in a pill above the button; the large one in its button.
  const shownTip = copied && card.style === "compact" ? "copied" : tip;

  // Tell the native side how tall the card is (and how much room a tooltip needs). The window is
  // shown by the first report, once the thumbnail is there, so it never flashes empty.
  const hintAbove = dragging && card.edge === "bottom";
  const extraTop = shownTip || hintAbove ? TIP_ROOM : 0;
  const extraBottom = dragging && !hintAbove ? HINT_ROOM : 0;
  useEffect(() => {
    const el = cardEl;
    if (!el || !thumbReady) return;
    let last = "";
    const report = () => {
      const height = el.offsetHeight;
      const key = `${String(height)}/${String(extraTop)}/${String(extraBottom)}`;
      // A hidden page measures 0, and the same size twice is not news.
      if (height < 1 || key === last) return;
      last = key;
      void platform.quickAccessSize(id, height, extraTop, extraBottom);
    };
    report();
    const observer = new ResizeObserver(report);
    observer.observe(el);
    return () => {
      observer.disconnect();
    };
  }, [id, cardEl, thumbReady, extraTop, extraBottom, status, deleted, card.style]);

  // Hovering means being over the card itself, not over the transparent room around it.
  useEffect(() => {
    const el = cardEl;
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
  }, [cardEl]);

  return (
    <>
      <QuickAccessCardView
        card={card}
        copied={copied}
        status={status}
        deleted={deleted}
        tip={deleted ? null : shownTip}
        timer="running"
        timerSecs={deleted ? UNDO_SECS : card.autoCloseSecs}
        paused={hovered || busy || dragging}
        dragging={dragging}
        onDragStart={startDrag}
        onCardElement={setCardEl}
        onDelete={remove}
        onUndo={undo}
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
