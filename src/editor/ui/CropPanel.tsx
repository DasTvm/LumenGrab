import { ArrowLeftRight, Crop, Info, Link2, Link2Off } from "lucide-react";
import { Button } from "@/ui/components/button";
import { cn } from "@/ui/lib/utils";
import { Section } from "./controls";
import { useStores, useUi } from "./context";
import {
  applyCrop,
  cancelCrop,
  resetCrop,
  setCropPreset,
  setCropSize,
  swapCrop,
  toggleCropLock,
} from "./crop-mode";
import type { CropPreset } from "./ui-store";

const RATIOS: { preset: CropPreset; label: string }[] = [
  { preset: "free", label: "Free" },
  { preset: "original", label: "Original" },
  { preset: "1:1", label: "1:1" },
  { preset: "4:3", label: "4:3" },
  { preset: "16:9", label: "16:9" },
];

const PRESET_LABEL: Record<CropPreset, string> = {
  free: "Free",
  original: "Original",
  "1:1": "1:1",
  "4:3": "4:3",
  "16:9": "16:9",
  custom: "Custom",
};

/** The panel of the crop tool (design: Crop mode): ratio, size, and Apply, Cancel, Reset. */
export function CropPanel() {
  const { editor, ui } = useStores();
  const draft = useUi((s) => s.crop);
  if (!draft) return null;
  const locked = draft.ratio !== null;

  return (
    <div className="flex min-h-0 flex-1 flex-col" data-testid="crop-panel">
      <div className="flex flex-col gap-1 border-b border-border pb-3">
        <div className="flex items-center gap-2">
          <span className="flex size-7 items-center justify-center rounded-md bg-brand text-brand-foreground">
            <Crop aria-hidden className="size-4" />
          </span>
          <h2 className="text-[15px] font-semibold">Crop</h2>
          <span className="flex-1" />
          <kbd className="rounded bg-muted px-1.5 py-0.5 font-sans text-xs text-muted-foreground">
            C
          </kbd>
        </div>
        <p className="text-xs text-muted-foreground">Drag the edges or choose a ratio</p>
      </div>
      <div className="flex flex-1 flex-col gap-4 pt-4">
        <Section label="Aspect ratio" value={PRESET_LABEL[draft.preset]}>
          <div role="radiogroup" aria-label="Aspect ratio" className="grid grid-cols-3 gap-2">
            {RATIOS.map((r) => (
              <button
                key={r.preset}
                type="button"
                role="radio"
                aria-checked={draft.preset === r.preset}
                className={cn(
                  "h-[34px] rounded-md border border-border text-[13px] font-medium",
                  draft.preset === r.preset
                    ? "bg-muted text-foreground"
                    : "bg-background text-muted-foreground hover:text-foreground",
                )}
                onClick={() => {
                  setCropPreset(ui, r.preset);
                }}
              >
                {r.label}
              </button>
            ))}
            <button
              type="button"
              className="flex h-[34px] items-center justify-center gap-1.5 rounded-md border border-border bg-background text-[13px] font-medium text-muted-foreground hover:text-foreground"
              onClick={() => {
                swapCrop(ui);
              }}
            >
              <ArrowLeftRight aria-hidden className="size-3.5" />
              Swap
            </button>
          </div>
        </Section>
        <Section label="Size" value="pixels">
          <div className="flex items-center gap-2">
            <SizeField
              label="Width"
              axis="W"
              value={draft.rect.width}
              onCommit={(v) => {
                setCropSize(ui, "width", v);
              }}
            />
            <Button
              variant="ghost"
              size="icon"
              className="size-8"
              aria-label="Lock ratio"
              aria-pressed={locked}
              onClick={() => {
                toggleCropLock(ui);
              }}
            >
              {locked ? <Link2 aria-hidden /> : <Link2Off aria-hidden />}
            </Button>
            <SizeField
              label="Height"
              axis="H"
              value={draft.rect.height}
              onCommit={(v) => {
                setCropSize(ui, "height", v);
              }}
            />
          </div>
        </Section>
        <p className="flex gap-2 border-t border-border pt-4 text-[13px] text-muted-foreground">
          <Info aria-hidden className="mt-0.5 size-4 shrink-0" />
          Cropping never changes your original. You can adjust the crop again at any time.
        </p>
      </div>
      <div className="flex flex-col gap-2 pt-2">
        <Button
          variant="accent"
          className="h-9"
          onClick={() => {
            applyCrop(editor, ui);
          }}
        >
          Apply crop
        </Button>
        <div className="grid grid-cols-2 gap-2">
          <Button
            variant="outline"
            className="h-9"
            onClick={() => {
              cancelCrop(editor, ui);
            }}
          >
            Cancel
          </Button>
          <Button
            variant="outline"
            className="h-9"
            onClick={() => {
              resetCrop(ui);
            }}
          >
            Reset
          </Button>
        </div>
        <p className="text-center text-xs text-muted-foreground">Enter to apply · Esc to cancel</p>
      </div>
    </div>
  );
}

function SizeField({
  label,
  axis,
  value,
  onCommit,
}: {
  label: string;
  axis: string;
  value: number;
  onCommit: (value: number) => void;
}) {
  return (
    <label className="flex h-9 min-w-0 flex-1 items-center gap-2 rounded-md border border-border bg-background px-3 text-[13px] focus-within:ring-2 focus-within:ring-ring">
      <span aria-hidden className="text-muted-foreground">
        {axis}
      </span>
      <input
        aria-label={label}
        inputMode="numeric"
        className="min-w-0 flex-1 bg-transparent tabular-nums outline-none"
        // Re-keyed by the value: a drag of the frame updates the field, typing is committed on Enter or blur.
        key={value}
        defaultValue={value}
        onKeyDown={(e) => {
          e.stopPropagation();
          if (e.key === "Enter") e.currentTarget.blur();
        }}
        onBlur={(e) => {
          const n = Number(e.currentTarget.value);
          if (Number.isFinite(n) && n !== value) onCommit(n);
          else e.currentTarget.value = String(value);
        }}
      />
    </label>
  );
}
