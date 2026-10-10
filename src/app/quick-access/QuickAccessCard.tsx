import { useLayoutEffect, useRef, useState, type ReactNode, type RefObject } from "react";
import { Check, CircleCheck, Copy, Download, TriangleAlert, X } from "lucide-react";
import type { QuickAccessCard as Card } from "@/platform";
import { currentOs } from "@/platform/os";
import { Button } from "@/ui/components/button";
import { cn } from "@/ui/lib/utils";

/** Which button a tooltip belongs to. */
export type TipTarget = "copy" | "save" | "close";

/** The row under the actions: where "Save as…" put a copy, or what went wrong. */
export type StatusRow =
  | { kind: "saved"; folder: string; fileName: string }
  | { kind: "error"; title: string; detail: string; retry: "copy" | "save" };

export interface QuickAccessCardViewProps {
  card: Card;
  /** The Copy button shows its "done" state. */
  copied?: boolean;
  status?: StatusRow | null;
  /** The tooltip (or the "Copied" pill) to show above the buttons. */
  tip?: TipTarget | "copied" | null;
  /**
   * The auto-close line. `running`: a CSS animation of `card.autoCloseSecs`, paused when `paused`.
   * A number is a fixed fill from 0 to 1 (for the design gallery).
   */
  timer?: "running" | number;
  paused?: boolean;
  onCopy?: () => void;
  onSave?: () => void;
  onClose?: () => void;
  onReveal?: () => void;
  onRetry?: () => void;
  onTip?: (tip: TipTarget | null) => void;
  /** Called when the auto-close line has run out. */
  onExpire?: () => void;
  onThumbLoaded?: () => void;
  /** The element to measure for the card's height. */
  cardRef?: RefObject<HTMLDivElement | null>;
}

const TIP_TEXT: Record<TipTarget, { label: string; key?: string }> = {
  copy: { label: "Copy image", key: currentOs() === "macos" ? "⌘C" : "Ctrl+C" },
  save: { label: "Save as…" },
  close: { label: "Close", key: "Esc" },
};

/** Design: "Quick Access" (compact). Pure: all state comes in through props. */
export function QuickAccessCardView({
  card,
  copied = false,
  status = null,
  tip = null,
  timer,
  paused = false,
  onCopy,
  onSave,
  onClose,
  onReveal,
  onRetry,
  onTip,
  onExpire,
  onThumbLoaded,
  cardRef,
}: QuickAccessCardViewProps) {
  const rootRef = useRef<HTMLDivElement>(null);
  const copyButton = useRef<HTMLButtonElement>(null);
  const saveButton = useRef<HTMLButtonElement>(null);
  const closeButton = useRef<HTMLButtonElement>(null);
  // Where the tooltip points: the middle of its button, measured relative to the window.
  const [tipLeft, setTipLeft] = useState(0);
  const tipTarget: TipTarget | null = tip === "copied" ? "copy" : tip;
  useLayoutEffect(() => {
    const root = rootRef.current;
    const button =
      tipTarget === "copy"
        ? copyButton.current
        : tipTarget === "save"
          ? saveButton.current
          : tipTarget === "close"
            ? closeButton.current
            : null;
    if (!root || !button) return;
    const r = root.getBoundingClientRect();
    const b = button.getBoundingClientRect();
    setTipLeft(b.left - r.left + b.width / 2);
  }, [tipTarget, card.width]);

  const tipText = tip === null || tip === "copied" ? null : TIP_TEXT[tip];

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
        ref={cardRef}
        data-testid="quick-access-card"
        className="relative overflow-hidden rounded-xl border border-border bg-card text-card-foreground shadow-[0_10px_28px_rgb(0_0_0/0.15)]"
        style={{ width: card.width }}
      >
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
              ref={copyButton}
              variant="ghost"
              size="icon"
              aria-label="Copy image"
              active={copied || undefined}
              onClick={onCopy}
              onPointerEnter={() => onTip?.("copy")}
              onFocus={() => onTip?.("copy")}
              onBlur={() => onTip?.(null)}
            >
              <Copy />
            </Button>
            <Button
              ref={saveButton}
              variant="ghost"
              size="icon"
              aria-label="Save as…"
              onClick={onSave}
              onPointerEnter={() => onTip?.("save")}
              onFocus={() => onTip?.("save")}
              onBlur={() => onTip?.(null)}
            >
              <Download />
            </Button>
          </div>
          <span aria-hidden className="h-10 w-px shrink-0 bg-border" />
          <Button
            ref={closeButton}
            variant="ghost"
            size="icon"
            aria-label="Close"
            onClick={onClose}
            onPointerEnter={() => onTip?.("close")}
            onFocus={() => onTip?.("close")}
            onBlur={() => onTip?.(null)}
          >
            <X />
          </Button>
        </div>

        {status ? <StatusRowView status={status} onReveal={onReveal} onRetry={onRetry} /> : null}

        {timer !== undefined && card.autoCloseSecs > 0 ? (
          <div aria-hidden className="absolute inset-x-0 bottom-0 h-[3px] bg-secondary">
            <div
              data-testid="auto-close-line"
              className="h-full origin-left bg-foreground"
              style={
                timer === "running"
                  ? {
                      animation: `lg-timer ${String(card.autoCloseSecs)}s linear forwards`,
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
          ) : tipText ? (
            <>
              <span className="text-xs font-medium text-white">{tipText.label}</span>
              {tipText.key ? (
                <span className="text-[11px] text-overlay-muted">{tipText.key}</span>
              ) : null}
            </>
          ) : null}
        </Tip>
      ) : null}
    </div>
  );
}

/** The dark tooltip bubble above a button (design: Tooltip). Never takes the pointer. */
function Tip({ left, top, children }: { left: number; top: number; children: ReactNode }) {
  return (
    <div
      role="tooltip"
      className="pointer-events-none absolute flex items-center gap-2 rounded-lg bg-overlay-surface px-2.5 py-1.5 whitespace-nowrap shadow-[0_6px_16px_rgb(0_0_0/0.25)]"
      style={{ left, top, transform: "translate(-50%, -100%)" }}
    >
      {children}
    </div>
  );
}

function StatusRowView({
  status,
  onReveal,
  onRetry,
}: {
  status: StatusRow;
  onReveal?: () => void;
  onRetry?: () => void;
}) {
  const failed = status.kind === "error";
  return (
    <div
      role="status"
      className={cn(
        "flex items-center gap-2.5 border-t border-border px-3.5 py-2.5",
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
