import { useEffect, useMemo, useRef, useState } from "react";
import { Check, ChevronDown, TriangleAlert } from "lucide-react";
import { isSystemFontId, SYSTEM_FONT_PREFIX, systemFontFamily } from "@/document/limits";
import { platform } from "@/platform";
import { cn } from "@/ui/lib/utils";
import { BUNDLED_FONTS, fontFamily } from "../draw/text";

/** The device's font list, asked for once (loading the system fonts takes a moment). */
let installed: Promise<string[]> | null = null;
export function installedFonts(): Promise<string[]> {
  installed ??= platform.listSystemFonts().catch(() => []);
  return installed;
}

/** Most rows shown for the installed fonts; typing narrows the list. */
const MAX_ROWS = 150;

export const fontLabel = (fontId: string): string =>
  isSystemFontId(fontId)
    ? systemFontFamily(fontId)
    : (BUNDLED_FONTS.find((f) => f.id === fontId)?.label ?? "Inter");

interface Props {
  value: string;
  onChange: (fontId: string) => void;
}

/**
 * The font choice of the text tool: the fonts that ship with LumenGrab (they look the same on every device)
 * and, below them, every font installed on this device (the file then stores only the name, see
 * docs/FORMAT.md section 8).
 */
export function FontPicker({ value, onChange }: Props) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [fonts, setFonts] = useState<string[] | null>(null);
  const root = useRef<HTMLDivElement>(null);
  const search = useRef<HTMLInputElement>(null);

  // The device's fonts: needed to open the list, and to tell whether the chosen font is missing here.
  useEffect(() => {
    let current = true;
    void installedFonts().then((list) => {
      if (current) setFonts(list);
    });
    return () => {
      current = false;
    };
  }, []);

  useEffect(() => {
    if (!open) return;
    search.current?.focus();
    const away = (e: PointerEvent) => {
      if (!root.current?.contains(e.target as Node)) setOpen(false);
    };
    const key = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.stopPropagation();
        setOpen(false);
      }
    };
    window.addEventListener("pointerdown", away, true);
    window.addEventListener("keydown", key, true);
    return () => {
      window.removeEventListener("pointerdown", away, true);
      window.removeEventListener("keydown", key, true);
    };
  }, [open]);

  const needle = query.trim().toLowerCase();
  const bundled = BUNDLED_FONTS.filter((f) => f.label.toLowerCase().includes(needle));
  const matching = useMemo(
    () => (fonts ?? []).filter((f) => f.toLowerCase().includes(needle)),
    [fonts, needle],
  );
  const missing =
    isSystemFontId(value) && fonts !== null && !fonts.includes(systemFontFamily(value));

  const choose = (fontId: string) => {
    onChange(fontId);
    setOpen(false);
    setQuery("");
  };

  return (
    <div ref={root} className="relative">
      <button
        type="button"
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-label={`Font: ${fontLabel(value)}`}
        data-testid="font-button"
        className="flex h-9 w-full items-center justify-between gap-2 rounded-md border border-border bg-background px-3 text-left text-[14px] outline-none focus-visible:ring-2 focus-visible:ring-ring"
        style={{ fontFamily: fontFamily(value) }}
        onClick={() => {
          setOpen(!open);
        }}
      >
        <span className="truncate">{fontLabel(value)}</span>
        {missing ? (
          <TriangleAlert
            aria-label="Not installed on this device"
            className="size-4 shrink-0 text-warning"
          />
        ) : null}
        <ChevronDown aria-hidden className="size-4 shrink-0 text-muted-foreground" />
      </button>
      {open ? (
        <div
          role="dialog"
          aria-label="Choose a font"
          className="absolute inset-x-0 top-full z-30 mt-2 flex max-h-80 flex-col rounded-lg border border-border bg-card shadow-[0_8px_24px_rgb(0_0_0/0.25)]"
        >
          <input
            ref={search}
            aria-label="Search fonts"
            placeholder="Search fonts"
            value={query}
            spellCheck={false}
            className="m-2 h-8 shrink-0 rounded-md border border-border bg-background px-2 text-[13px] outline-none focus-visible:ring-2 focus-visible:ring-ring"
            onChange={(e) => {
              setQuery(e.target.value);
            }}
            onKeyDown={(e) => {
              e.stopPropagation();
              if (e.key === "Enter") {
                const first = bundled[0]
                  ? bundled[0].id
                  : matching[0]
                    ? `${SYSTEM_FONT_PREFIX}${matching[0]}`
                    : null;
                if (first) choose(first);
              }
            }}
          />
          <div
            role="listbox"
            aria-label="Fonts"
            className="flex min-h-0 flex-col overflow-y-auto px-1 pb-2"
          >
            {bundled.length > 0 ? (
              <>
                <p className="px-2 pt-1 pb-1 text-[11px] font-medium text-muted-foreground">
                  LumenGrab fonts
                </p>
                {bundled.map((f) => (
                  <Row
                    key={f.id}
                    label={f.label}
                    selected={value === f.id}
                    family={fontFamily(f.id)}
                    onPick={() => {
                      choose(f.id);
                    }}
                  />
                ))}
              </>
            ) : null}
            <p className="px-2 pt-2 pb-1 text-[11px] font-medium text-muted-foreground">
              Installed on this device
            </p>
            {fonts === null ? (
              <p className="px-2 py-1 text-xs text-muted-foreground">Looking for fonts…</p>
            ) : matching.length === 0 ? (
              <p className="px-2 py-1 text-xs text-muted-foreground">
                {needle ? "No installed font matches." : "No installed fonts found."}
              </p>
            ) : (
              <>
                {matching.slice(0, MAX_ROWS).map((family) => (
                  <Row
                    key={family}
                    label={family}
                    selected={value === `${SYSTEM_FONT_PREFIX}${family}`}
                    onPick={() => {
                      choose(`${SYSTEM_FONT_PREFIX}${family}`);
                    }}
                  />
                ))}
                {matching.length > MAX_ROWS ? (
                  <p className="px-2 py-1 text-xs text-muted-foreground">
                    {`${String(matching.length - MAX_ROWS)} more: type to narrow the list.`}
                  </p>
                ) : null}
              </>
            )}
          </div>
        </div>
      ) : null}
      {missing ? (
        <p className="mt-1.5 text-xs text-muted-foreground" role="status">
          {`“${systemFontFamily(value)}” is not installed on this device. Inter is shown instead.`}
        </p>
      ) : null}
    </div>
  );
}

function Row({
  label,
  selected,
  family,
  onPick,
}: {
  label: string;
  selected: boolean;
  family?: string;
  onPick: () => void;
}) {
  return (
    <button
      type="button"
      role="option"
      aria-selected={selected}
      className={cn(
        "flex h-8 shrink-0 items-center justify-between gap-2 rounded-md px-2 text-left text-[14px] outline-none hover:bg-muted focus-visible:bg-muted",
        selected && "bg-muted",
      )}
      style={family ? { fontFamily: family } : undefined}
      onClick={onPick}
    >
      <span className="truncate">{label}</span>
      {selected ? <Check aria-hidden className="size-4 shrink-0" /> : null}
    </button>
  );
}
