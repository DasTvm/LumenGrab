import { Moon, Sun } from "lucide-react";
import type { Presentation } from "@/document/schema";
import { cn } from "@/ui/lib/utils";
import { Pills, Section } from "../controls";
import { usePresentation } from "./use-presentation";

type FrameType = Presentation["frame"]["type"];

const FRAMES: { id: FrameType; label: string }[] = [
  { id: "none", label: "None" },
  { id: "macos-window", label: "macOS" },
  { id: "windows-window", label: "Windows" },
  { id: "browser", label: "Browser" },
  { id: "minimal", label: "Minimal" },
  { id: "terminal", label: "Terminal" },
];

/** A tiny picture of each frame: a window with its title bar. */
function Glyph({ type }: { type: FrameType }) {
  const bar = type === "terminal" ? "#1F1F23" : "#E4E4E7";
  const body = type === "terminal" ? "#1F1F23" : "#FFFFFF";
  return (
    <svg viewBox="0 0 56 38" className="h-[38px] w-[56px]" aria-hidden>
      <rect
        x="2"
        y="2"
        width="52"
        height="34"
        rx="4"
        fill={body}
        stroke="#D4D4D8"
        strokeWidth="1"
      />
      {type !== "none" ? (
        <path d="M2 6 a4 4 0 0 1 4 -4 h44 a4 4 0 0 1 4 4 v5 h-52z" fill={bar} />
      ) : null}
      {type === "macos-window" || type === "browser" || type === "terminal" ? (
        <>
          <circle cx="8" cy="7" r="1.5" fill="#FF5F57" />
          <circle cx="13" cy="7" r="1.5" fill="#FEBC2E" />
          <circle cx="18" cy="7" r="1.5" fill="#28C840" />
        </>
      ) : null}
      {type === "windows-window" ? (
        <>
          <circle cx="40" cy="7" r="1.5" fill="#A1A1AA" />
          <circle cx="45" cy="7" r="1.5" fill="#A1A1AA" />
          <circle cx="50" cy="7" r="1.5" fill="#A1A1AA" />
        </>
      ) : null}
      {type === "minimal" ? (
        <>
          <circle cx="8" cy="7" r="1.5" fill="#C7C7CC" />
          <circle cx="13" cy="7" r="1.5" fill="#C7C7CC" />
          <circle cx="18" cy="7" r="1.5" fill="#C7C7CC" />
        </>
      ) : null}
      {type === "browser" ? (
        <rect x="24" y="5" width="22" height="4" rx="2" fill="#FFFFFF" />
      ) : null}
      <rect
        x="9"
        y={type === "none" ? 9 : 17}
        width="26"
        height="3"
        rx="1.5"
        fill={type === "terminal" ? "#C8FF2E" : "#E4E4E7"}
      />
      <rect
        x="9"
        y={type === "none" ? 16 : 24}
        width="38"
        height="3"
        rx="1.5"
        fill={type === "terminal" ? "#52525B" : "#E4E4E7"}
      />
    </svg>
  );
}

/** Window frame (design): six frames, the title (and address) and light or dark. */
export function FrameSection() {
  const { p, set } = usePresentation();
  const frame = p.frame;
  const current = FRAMES.find((f) => f.id === frame.type);
  const hasTitle = frame.type !== "none" && frame.type !== "minimal";
  const field = (label: string, key: "title" | "url", placeholder: string) => (
    <label className="flex h-9 items-center gap-2 rounded-md border border-border bg-background px-3 text-[13px] focus-within:ring-2 focus-within:ring-ring">
      <span className="text-muted-foreground">{label}</span>
      <input
        aria-label={label}
        value={frame[key] ?? ""}
        placeholder={placeholder}
        maxLength={key === "url" ? 2000 : 500}
        className="min-w-0 flex-1 bg-transparent outline-none placeholder:text-muted-foreground/60"
        onKeyDown={(e) => {
          e.stopPropagation();
        }}
        onChange={(e) => {
          const value = e.target.value;
          set((d) => {
            if (key === "title") {
              if (value) d.frame.title = value;
              else delete d.frame.title;
            } else if (value) d.frame.url = value;
            else delete d.frame.url;
          });
        }}
      />
    </label>
  );
  return (
    <Section label="Window frame" value={current?.label ?? ""}>
      <div role="radiogroup" aria-label="Window frame" className="grid grid-cols-3 gap-2">
        {FRAMES.map((f) => {
          const selected = frame.type === f.id;
          return (
            <button
              key={f.id}
              type="button"
              role="radio"
              aria-checked={selected}
              className="flex flex-col items-center gap-1 text-[13px]"
              onClick={() => {
                set((d) => {
                  d.frame.type = f.id;
                });
              }}
            >
              <span
                className={cn(
                  "flex h-[60px] w-full items-center justify-center rounded-md bg-muted",
                  selected ? "ring-2 ring-primary" : "ring-1 ring-border",
                )}
              >
                <Glyph type={f.id} />
              </span>
              <span className={selected ? "font-medium" : "text-muted-foreground"}>{f.label}</span>
            </button>
          );
        })}
      </div>
      {hasTitle ? field("Title", "title", "Untitled") : null}
      {frame.type === "browser" ? field("URL", "url", "example.com") : null}
      {frame.type !== "none" && frame.type !== "terminal" ? (
        <Pills
          label="Frame theme"
          value={frame.theme ?? "light"}
          options={[
            { value: "light", label: "Light", icon: <Sun aria-hidden className="size-3.5" /> },
            { value: "dark", label: "Dark", icon: <Moon aria-hidden className="size-3.5" /> },
          ]}
          onChange={(theme) => {
            set((d) => {
              d.frame.theme = theme;
            });
          }}
        />
      ) : null}
    </Section>
  );
}
