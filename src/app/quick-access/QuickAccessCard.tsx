import { useLayoutEffect, useRef, useState, type ReactNode } from "react";
import { Check, CircleCheck, Copy, Download, Trash2, TriangleAlert, X } from "lucide-react";
import type { QuickAccessCard as Card } from "@/platform";
import { currentOs } from "@/platform/os";
import { Button } from "@/ui/components/button";
import { formatBytes } from "@/ui/lib/format";
import { cn } from "@/ui/lib/utils";

/** Which button a tooltip belongs to. */
export type TipTarget = "copy" | "save" | "close" | "delete";

/** The row under the actions: where "Save as…" put a copy, or what went wrong. */
export type StatusRow =
  | { kind: "saved"; folder: string; fileName: string }
  | { kind: "error"; title: string; detail: string; retry: "copy" | "save" };

export interface QuickAccessCardViewProps {
  card: Card;
  /** The Copy button shows its "done" state. */
  copied?: boolean;
  status?: StatusRow | null;
  /** "Delete" was pressed: the card turns into "moved to the Trash" with an Undo button. */
  deleted?: boolean;
  /** The tooltip (or, on the compact card, the "Copied" pill) to show above the buttons. */
  tip?: TipTarget | "copied" | null;
  /**
   * The line at the bottom. `running`: a CSS animation of `timerSecs`, paused when `paused`.
   * A number is a fixed fill from 0 to 1 (for the design gallery).
   */
  timer?: "running" | number;
  /** Length of the line; the auto-close seconds of the card unless given (the undo line is shorter). */
  timerSecs?: number;
  paused?: boolean;
  onCopy?: () => void;
  onSave?: () => void;
  onClose?: () => void;
  onReveal?: () => void;
  onRetry?: () => void;
  onDelete?: () => void;
  onUndo?: () => void;
  onTip?: (tip: TipTarget | null) => void;
  /** Called when the line has run out. */
  onExpire?: () => void;
  onThumbLoaded?: () => void;
  /** Called with the card element, for measuring its height. */
  onCardElement?: (el: HTMLDivElement | null) => void;
}

const TIP_TEXT: Record<TipTarget, { label: string; key?: string }> = {
  copy: { label: "Copy image", key: currentOs() === "macos" ? "⌘C" : "Ctrl+C" },
  save: { label: "Save as…" },
  close: { label: "Close", key: "Esc" },
  delete: { label: "Delete screenshot" },
};

const CARD_CLASS =
  "relative overflow-hidden rounded-xl border border-border bg-card text-card-foreground shadow-[0_10px_28px_rgb(0_0_0/0.15)]";

/** Design: "Quick Access" (compact), "Quick Access Large" and "Quick Access Deleted". Pure: all state comes in through props. */
export function QuickAccessCardView(props: QuickAccessCardViewProps) {
  const {
    card,
    deleted = false,
    tip = null,
    timer,
    timerSecs,
    paused = false,
    onTip,
    onExpire,
    onCardElement,
  } = props;
  const rootRef = useRef<HTMLDivElement>(null);
  const anchors = useRef<Partial<Record<TipTarget, HTMLElement | null>>>({});
  const anchor = (target: TipTarget) => (el: HTMLElement | null) => {
    anchors.current[target] = el;
  };

  // Where the tooltip points: the middle of its button, measured relative to the window.
  const [tipLeft, setTipLeft] = useState(0);
  const tipTarget: TipTarget | null = tip === "copied" ? "copy" : tip;
  useLayoutEffect(() => {
    const root = rootRef.current;
    const button = tipTarget ? anchors.current[tipTarget] : null;
    if (!root || !button) return;
    const r = root.getBoundingClientRect();
    const b = button.getBoundingClientRect();
    setTipLeft(b.left - r.left + b.width / 2);
  }, [tipTarget, card.width, card.style]);

  const seconds = timerSecs ?? card.autoCloseSecs;
  const body = deleted ? (
    <DeletedBody {...props} anchor={anchor} />
  ) : card.style === "large" ? (
    <LargeBody {...props} anchor={anchor} />
  ) : (
    <CompactBody {...props} anchor={anchor} />
  );

  return (
    <div
      ref={rootRef}
      className="relative"
      style={{
        paddingTop: card.pad.top,
        paddingRight: card.pad.right,
        paddingBottom: card.pad.bottom,
        paddingLeft: card.pad.left,
      }}
      onPointerLeave={() => onTip?.(null)}
    >
      <div
        ref={onCardElement}
        data-testid="quick-access-card"
        className={CARD_CLASS}
        style={{ width: card.width }}
      >
        {body}
        {timer !== undefined && seconds > 0 ? (
          <div aria-hidden className="absolute inset-x-0 bottom-0 h-[3px] bg-secondary">
            <div
              key={deleted ? "undo" : "auto-close"}
              data-testid={deleted ? "undo-line" : "auto-close-line"}
              className="h-full origin-left bg-foreground"
              style={
                timer === "running"
                  ? {
                      animation: `lg-timer ${String(seconds)}s linear forwards`,
                      animationPlayState: paused ? "paused" : "running",
                    }
                  : { transform: `scaleX(${String(timer)})` }
              }
              onAnimationEnd={onExpire}
            />
          </div>
        ) : null}
      </div>

      {tip !== null && card.pad.top >= 44 ? (
        <Tip left={tipLeft} top={card.pad.top - 8}>
          {tip === "copied" ? (
            <>
              <Check aria-hidden className="size-[13px] text-brand" />
              <span className="text-xs font-medium text-overlay-foreground">Copied</span>
            </>
          ) : (
            <>
              <span className="text-xs font-medium text-white">{TIP_TEXT[tip].label}</span>
              {TIP_TEXT[tip].key ? (
                <span className="text-[11px] text-overlay-muted">{TIP_TEXT[tip].key}</span>
              ) : null}
            </>
          )}
        </Tip>
      ) : null}
    </div>
  );
}

type Anchor = (target: TipTarget) => (el: HTMLElement | null) => void;
type BodyProps = QuickAccessCardViewProps & { anchor: Anchor };

function CompactBody({
  card,
  copied,
  status,
  onCopy,
  onSave,
  onClose,
  onReveal,
  onRetry,
  onTip,
  onThumbLoaded,
  anchor,
}: BodyProps) {
  const tipEvents = (target: TipTarget) => ({
    onPointerEnter: () => onTip?.(target),
    onFocus: () => onTip?.(target),
    onBlur: () => onTip?.(null),
  });
  return (
    <>
      <div className="flex items-center gap-1.5 p-2">
        <img
          src={card.thumbUrl}
          alt=""
          draggable={false}
          onLoad={onThumbLoaded}
          onError={onThumbLoaded}
          className="size-14 shrink-0 rounded-md border border-border bg-muted object-cover"
        />
        <span aria-hidden className="h-10 w-px shrink-0 bg-border" />
        <div
          role="group"
          aria-label="Actions"
          className="flex flex-1 items-center justify-around gap-0.5"
        >
          <Button
            ref={anchor("copy")}
            variant="ghost"
            size="icon"
            aria-label="Copy image"
            active={copied || undefined}
            onClick={onCopy}
            {...tipEvents("copy")}
          >
            <Copy />
          </Button>
          <Button
            ref={anchor("save")}
            variant="ghost"
            size="icon"
            aria-label="Save as…"
            onClick={onSave}
            {...tipEvents("save")}
          >
            <Download />
          </Button>
        </div>
        <span aria-hidden className="h-10 w-px shrink-0 bg-border" />
        <Button
          ref={anchor("close")}
          variant="ghost"
          size="icon"
          aria-label="Close"
          onClick={onClose}
          {...tipEvents("close")}
        >
          <X />
        </Button>
      </div>
      {status ? <StatusRowView status={status} onReveal={onReveal} onRetry={onRetry} /> : null}
    </>
  );
}

function LargeBody({
  card,
  copied,
  status,
  onCopy,
  onSave,
  onClose,
  onReveal,
  onRetry,
  onDelete,
  onTip,
  onThumbLoaded,
  anchor,
}: BodyProps) {
  return (
    <div className="flex flex-col gap-2.5 p-2">
      <div className="relative h-[228px] w-full overflow-hidden rounded-md border border-border bg-muted">
        <img
          src={card.thumbUrl}
          alt=""
          draggable={false}
          onLoad={onThumbLoaded}
          onError={onThumbLoaded}
          className="size-full object-cover"
        />
        <span className="absolute top-2.5 left-2.5 rounded-full bg-overlay-surface/85 px-[9px] py-1 text-[11px] font-semibold text-white tabular-nums">
          {`${String(card.pixelWidth)} × ${String(card.pixelHeight)}`}
        </span>
        <button
          type="button"
          aria-label="Close"
          onClick={onClose}
          className="absolute top-2.5 right-2.5 flex size-7 items-center justify-center rounded-full bg-overlay-surface/85 text-white outline-none hover:bg-overlay-surface focus-visible:ring-2 focus-visible:ring-brand"
        >
          <X aria-hidden className="size-3.5" />
        </button>
      </div>

      <div className="flex items-center justify-between gap-3 px-0.5 text-xs">
        <span className="truncate font-medium">{card.fileName}</span>
        <span className="shrink-0 text-muted-foreground">
          {`${card.source} · ${formatBytes(card.bytes)}`}
        </span>
      </div>

      <div className="flex items-center justify-between">
        <div role="group" aria-label="Actions" className="flex items-center gap-1.5">
          <Button variant="accent" onClick={onCopy} aria-label="Copy image">
            {copied ? <Check /> : <Copy />}
            {copied ? "Copied" : "Copy"}
          </Button>
          <Button variant="outline" onClick={onSave} aria-label="Save as…">
            <Download />
            Save
          </Button>
        </div>
        <Button
          ref={anchor("delete")}
          variant="outline"
          size="icon"
          aria-label="Delete screenshot"
          onClick={onDelete}
          onPointerEnter={() => onTip?.("delete")}
          onFocus={() => onTip?.("delete")}
          onBlur={() => onTip?.(null)}
        >
          <Trash2 />
        </Button>
      </div>

      {status ? (
        <StatusRowView inset status={status} onReveal={onReveal} onRetry={onRetry} />
      ) : null}
    </div>
  );
}

function DeletedBody({ card, onUndo }: BodyProps) {
  return (
    <div className="flex items-center gap-3 p-3.5">
      <span className="flex size-9 shrink-0 items-center justify-center rounded-[10px] bg-secondary">
        <Trash2 aria-hidden className="size-[18px] text-muted-foreground" />
      </span>
      <div role="status" className="flex min-w-0 flex-1 flex-col gap-px">
        <span className="truncate text-[13px] font-semibold">Screenshot moved to Trash</span>
        <span className="truncate text-[11px] text-muted-foreground">{card.fileName}</span>
      </div>
      <Button variant="outline" onClick={onUndo}>
        Undo
      </Button>
    </div>
  );
}

/** The dark tooltip bubble above a button (design: Tooltip). Never takes the pointer. */
function Tip({ left, top, children }: { left: number; top: number; children: ReactNode }) {
  const ref = useRef<HTMLDivElement>(null);
  // Centred over its button, but never wider than the window: near the card's edge it slides inwards.
  const [fitted, setFitted] = useState(left);
  useLayoutEffect(() => {
    const el = ref.current;
    const room = el?.parentElement?.clientWidth;
    if (!el || !room) {
      setFitted(left);
      return;
    }
    const half = el.offsetWidth / 2;
    setFitted(Math.min(Math.max(left, half + 4), room - half - 4));
  }, [left, children]);
  return (
    <div
      ref={ref}
      role="tooltip"
      className="pointer-events-none absolute flex items-center gap-2 rounded-lg bg-overlay-surface px-2.5 py-1.5 whitespace-nowrap shadow-[0_6px_16px_rgb(0_0_0/0.25)]"
      style={{ left: fitted, top, transform: "translate(-50%, -100%)" }}
    >
      {children}
    </div>
  );
}

function StatusRowView({
  status,
  inset = false,
  onReveal,
  onRetry,
}: {
  status: StatusRow;
  /** Large card: the row sits inside the card padding with rounded corners; compact: full width. */
  inset?: boolean;
  onReveal?: () => void;
  onRetry?: () => void;
}) {
  const failed = status.kind === "error";
  return (
    <div
      role="status"
      className={cn(
        "flex items-center gap-2.5 px-3.5 py-2.5",
        inset ? "rounded-md border border-border" : "border-t border-border",
        failed ? "bg-destructive/5" : "bg-success/5",
      )}
    >
      {failed ? (
        <TriangleAlert aria-hidden className="size-[17px] shrink-0 text-destructive" />
      ) : (
        <CircleCheck aria-hidden className="size-[17px] shrink-0 text-success" />
      )}
      <div className="flex min-w-0 flex-1 flex-col gap-px">
        <span className="truncate text-[13px] font-semibold">
          {failed ? status.title : `Saved to ${status.folder}`}
        </span>
        <span className="truncate text-[11px] text-muted-foreground">
          {failed ? status.detail : status.fileName}
        </span>
      </div>
      <Button
        variant="outline"
        className="h-auto rounded-md px-3 py-[5px] text-xs font-semibold"
        onClick={failed ? onRetry : onReveal}
      >
        {failed ? "Retry" : "Show"}
      </Button>
    </div>
  );
}
