import type { ComponentType } from "react";
import {
  ClipboardX,
  Copy,
  Download,
  FolderOpen,
  Keyboard,
  RotateCw,
  ScanLine,
  Settings,
  Trash2,
  TriangleAlert,
  X,
} from "lucide-react";
import type { QuickAccessCard, QuickAccessNotice } from "@/platform";
import { Button } from "@/ui/components/button";
import { Keycap } from "@/ui/components/keycap";
import { LogoMark } from "@/ui/components/logo-mark";
import { cn } from "@/ui/lib/utils";

type IconComponent = ComponentType<{ className?: string; "aria-hidden"?: boolean }>;

const NOTICE_ICONS: Record<string, IconComponent> = {
  "triangle-alert": TriangleAlert,
  "clipboard-x": ClipboardX,
  keyboard: Keyboard,
  "scan-line": ScanLine,
  trash: Trash2,
};

const ACTION_ICONS: Record<string, IconComponent> = {
  refresh: RotateCw,
  folder: FolderOpen,
  download: Download,
  settings: Settings,
  copy: Copy,
};

export interface NoticeCardViewProps {
  card: QuickAccessCard & { notice: QuickAccessNotice };
  /** Index of the button whose action is running. */
  busy?: number | null;
  /** Replaces the text when the last action failed. */
  error?: string | null;
  onAction?: (index: number) => void;
  onClose?: () => void;
  onCardElement?: (el: HTMLDivElement | null) => void;
}

/** Design: "Toast" in Feedback and Errors. An error or warning with its own buttons. */
export function NoticeCardView({
  card,
  busy = null,
  error = null,
  onAction,
  onClose,
  onCardElement,
}: NoticeCardViewProps) {
  const { notice } = card;
  const Icon = NOTICE_ICONS[notice.icon] ?? TriangleAlert;
  const warning = notice.tone === "warning";
  if (notice.tone === "info") {
    return (
      <WelcomeCard
        {...{ card, busy, error, onAction, onCardElement }}
        keys={notice.keys}
        notice={notice}
      />
    );
  }
  return (
    <div
      style={{
        paddingTop: card.pad.top,
        paddingRight: card.pad.right,
        paddingBottom: card.pad.bottom,
        paddingLeft: card.pad.left,
      }}
    >
      <div
        ref={onCardElement}
        data-testid="quick-access-card"
        role="alert"
        className="flex gap-3.5 overflow-hidden rounded-xl border border-border bg-card p-[18px] text-card-foreground shadow-[0_10px_28px_rgb(0_0_0/0.15)]"
        style={{ width: card.width }}
      >
        <span
          className={cn(
            "flex size-9 shrink-0 items-center justify-center rounded-[10px]",
            warning ? "bg-warning/10 text-warning" : "bg-destructive/10 text-destructive",
          )}
        >
          <Icon aria-hidden className="size-[19px]" />
        </span>
        <div className="flex min-w-0 flex-1 flex-col gap-1">
          <h2 className="text-sm font-semibold">{notice.title}</h2>
          <p className="text-[13px] leading-[1.45] text-muted-foreground">{error ?? notice.body}</p>
          <div className="flex gap-2 pt-2.5">
            {notice.actions.map((action, i) => {
              const ActionIcon = ACTION_ICONS[action.icon];
              return (
                <Button
                  key={action.label}
                  variant={action.primary ? "default" : "outline"}
                  disabled={busy !== null}
                  className="px-4 py-2 text-sm"
                  onClick={() => onAction?.(i)}
                >
                  {ActionIcon ? <ActionIcon aria-hidden /> : null}
                  {action.label}
                </Button>
              );
            })}
          </div>
        </div>
        <button
          type="button"
          aria-label="Close"
          onClick={onClose}
          className="-m-1 flex size-6 shrink-0 items-center justify-center self-start rounded-md text-muted-foreground outline-none hover:bg-accent focus-visible:ring-2 focus-visible:ring-ring"
        >
          <X aria-hidden className="size-4" />
        </button>
      </div>
    </div>
  );
}

/** Design: "Welcome Hint". Bigger than a notice, with the app logo and the shortcut as keycaps. */
function WelcomeCard({
  card,
  notice,
  keys,
  busy,
  error,
  onAction,
  onCardElement,
}: NoticeCardViewProps & { notice: QuickAccessNotice; keys: string[] }) {
  return (
    <div
      style={{
        paddingTop: card.pad.top,
        paddingRight: card.pad.right,
        paddingBottom: card.pad.bottom,
        paddingLeft: card.pad.left,
      }}
    >
      <div
        ref={onCardElement}
        data-testid="quick-access-card"
        role="dialog"
        aria-label={notice.title}
        className="flex flex-col gap-4 overflow-hidden rounded-xl border border-border bg-card p-[22px] text-card-foreground shadow-[0_16px_40px_rgb(0_0_0/0.4)]"
        style={{ width: card.width }}
      >
        <div className="flex items-center gap-3">
          <span className="flex size-11 shrink-0 items-center justify-center rounded-xl bg-overlay-surface text-white">
            <LogoMark className="size-7" />
          </span>
          <h2 className="text-[17px] font-semibold">{notice.title}</h2>
        </div>
        <p className="text-sm leading-normal text-muted-foreground">{error ?? notice.body}</p>
        {keys.length > 0 ? (
          <div
            role="img"
            aria-label={`Shortcut: ${keys.join(" ")}`}
            className="flex items-center gap-1.5"
          >
            {keys.map((key) => (
              <Keycap key={key} className="h-[30px] rounded-[7px] px-[11px] text-[13px]">
                {key}
              </Keycap>
            ))}
          </div>
        ) : null}
        <div className="flex justify-end gap-2">
          {notice.actions.map((action, i) => (
            <Button
              key={action.label}
              variant={action.primary ? "accent" : "outline"}
              disabled={busy !== null}
              onClick={() => onAction?.(i)}
            >
              {action.label}
            </Button>
          ))}
        </div>
      </div>
    </div>
  );
}
