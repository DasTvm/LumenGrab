import type { ReactNode } from "react";
import sampleCapture from "@/platform/mock/sample-capture.png?url";
import type { QuickAccessCard } from "@/platform";
import { QuickAccessCardView, type QuickAccessCardViewProps } from "./quick-access/QuickAccessCard";

const CARD: QuickAccessCard = {
  id: "gallery",
  style: "compact",
  width: 340,
  autoCloseSecs: 5,
  thumbUrl: sampleCapture,
  pixelWidth: 1920,
  pixelHeight: 1080,
  fileName: "Screenshot 2026-10-09 at 14.02.png",
  folder: "Pictures/LumenGrab",
  source: "Area",
  bytes: 1_234_567,
  pad: { top: 52, right: 24, bottom: 24, left: 24 },
};

const LARGE: QuickAccessCard = {
  ...CARD,
  style: "large",
  width: 380,
  pad: { top: 52, right: 24, bottom: 24, left: 24 },
};

const LARGE_STATES: { name: string; note: string; props: Partial<QuickAccessCardViewProps> }[] = [
  {
    name: "L1 Large normal",
    note: "Big enough to check you captured the right thing.",
    props: { timer: 0.6 },
  },
  {
    name: "L2 Hover on Delete",
    note: "Tooltip above the Delete button.",
    props: { tip: "delete" },
  },
  {
    name: "L3 Deleted, with Undo",
    note: "Moved to the Trash. Undo brings it back while the line runs.",
    props: { deleted: true, timer: 0.65, timerSecs: 6 },
  },
  {
    name: "L4 Saved",
    note: "Same status row as the compact card, inside the padding.",
    props: { status: { kind: "saved", folder: "Pictures/LumenGrab", fileName: CARD.fileName } },
  },
];

const STATES: { name: string; note: string; props: Partial<QuickAccessCardViewProps> }[] = [
  { name: "01 Normal", note: "Pin and OCR are hidden until M6; Edit until M4.", props: {} },
  { name: "02 Hover with tooltip", note: "Tooltip above the button.", props: { tip: "copy" } },
  {
    name: "03 Copied",
    note: "The Copy button turns lime, a pill says Copied.",
    props: { copied: true, tip: "copied" },
  },
  {
    name: "04 Saved",
    note: "Shows the folder and file name. Click Show to reveal it.",
    props: { status: { kind: "saved", folder: "Pictures/LumenGrab", fileName: CARD.fileName } },
  },
  {
    name: "05 Save failed",
    note: "Stays open until you retry or close it.",
    props: {
      status: {
        kind: "error",
        title: "Could not save: folder not writable",
        detail: "Pictures/LumenGrab",
        retry: "save",
      },
    },
  },
  {
    name: "06 Auto-close timer",
    note: "A thin line shrinks to the left. Hovering pauses it.",
    props: { timer: 0.6 },
  },
];

function Frame({ name, note, children }: { name: string; note: string; children: ReactNode }) {
  return (
    <section
      aria-label={name}
      className="flex flex-col gap-2 rounded-2xl bg-[#e8ebf0] p-4 text-sm text-zinc-700"
    >
      <h2 className="font-semibold">{name}</h2>
      <div className="flex min-h-[170px] items-end justify-center">{children}</div>
      <p className="text-xs text-zinc-500">{note}</p>
    </section>
  );
}

/** Dev gallery of the Quick Access card states, to compare with the Pencil frames "Quick Access States". */
export function QuickAccessGallery() {
  return (
    <main className="grid grid-cols-2 gap-6 bg-background p-8" style={{ width: 1000 }}>
      {STATES.map(({ name, note, props }) => (
        <Frame key={name} name={name} note={note}>
          <QuickAccessCardView card={CARD} {...props} />
        </Frame>
      ))}
      {LARGE_STATES.map(({ name, note, props }) => (
        <Frame key={name} name={name} note={note}>
          <QuickAccessCardView card={LARGE} {...props} />
        </Frame>
      ))}
      <Frame
        name="L5 Several captures"
        note="Only the newest is large. Older ones shrink to the compact card and close first."
      >
        <div className="flex flex-col">
          <QuickAccessCardView
            card={{ ...CARD, width: 380, pad: { top: 4, right: 24, bottom: 4, left: 24 } }}
          />
          <QuickAccessCardView
            card={{ ...LARGE, pad: { top: 4, right: 24, bottom: 24, left: 24 } }}
          />
        </div>
      </Frame>
    </main>
  );
}
