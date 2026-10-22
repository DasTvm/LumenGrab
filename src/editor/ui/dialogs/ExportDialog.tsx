import { useEffect, useRef, useState } from "react";
import { Copy, FileArchive, Info, Link2, Link2Off, ShieldAlert, X } from "lucide-react";
import { Button } from "@/ui/components/button";
import { Pills, Section, Slider } from "../controls";
import {
  approxSize,
  baseName,
  customSize,
  fileNameFor,
  redactionNote,
  scaleOf,
  sizeForScale,
  type ExportFormat,
  type ImageFormat,
  type Size,
} from "../../export-model";
import { Modal } from "./Modal";

export interface ExportChoice {
  format: ExportFormat;
  fileName: string;
  size: Size;
  /** 0..1 */
  quality: number;
}

interface Props {
  /** The name of the document, used to suggest the file name. */
  documentName: string;
  /** The size of the picture (crop or full): the 1× of the size choices. */
  content: Size;
  /** Visible redactions: a flat export burns them in, a .lumengrab keeps the original pixels. */
  redactions: number;
  initialFormat: ExportFormat;
  webpAvailable: boolean;
  /** The background moves: Video / GIF is offered, and opens the dialog for it. */
  onVideo?: () => void;
  /** The size in bytes of the picture as JPG or WebP at this size and quality (for "about 380 KB"). */
  estimate: (format: "jpg" | "webp", size: Size, quality: number) => Promise<number>;
  onSave: (choice: ExportChoice) => void;
  onCopy: (size: Size) => void;
  onClose: () => void;
}

const SCALES = [0.5, 1, 2] as const;
const DEFAULT_QUALITY = { jpg: 90, webp: 85 } as const;

export function ExportDialog({
  documentName,
  content,
  redactions,
  initialFormat,
  webpAvailable,
  onVideo,
  estimate,
  onSave,
  onCopy,
  onClose,
}: Props) {
  const [format, setFormat] = useState<ExportFormat>(initialFormat);
  const [size, setSize] = useState<Size>(content);
  const [custom, setCustom] = useState(false);
  const [locked, setLocked] = useState(true);
  const [quality, setQuality] = useState<{ jpg: number; webp: number }>({ ...DEFAULT_QUALITY });
  const [fileName, setFileName] = useState(fileNameFor(documentName, initialFormat));
  const [bytes, setBytes] = useState<number | null>(null);

  const image = format !== "lumengrab";
  const lossy = format === "jpg" || format === "webp";
  const q = format === "webp" ? quality.webp : quality.jpg;
  const chip = custom ? "custom" : scaleOf(content, size);

  const pickFormat = (next: ExportFormat) => {
    setFormat(next);
    setFileName(fileNameFor(baseName(fileName), next));
  };

  // "about 380 KB": really encode (a moment after the last change), so the number is true.
  const request = useRef(0);
  useEffect(() => {
    if (!lossy) return;
    const id = (request.current += 1);
    const timer = setTimeout(() => {
      setBytes(null);
      estimate(format, size, q / 100).then(
        (n) => {
          if (request.current === id) setBytes(n);
        },
        () => {
          if (request.current === id) setBytes(null);
        },
      );
    }, 250);
    return () => {
      clearTimeout(timer);
    };
  }, [estimate, format, lossy, size, q]);

  const save = () => {
    onSave({
      format,
      fileName: fileName.trim() || fileNameFor(documentName, format),
      size,
      quality: q / 100,
    });
  };

  const options: { value: ExportFormat | "video"; label: string }[] = [
    { value: "png", label: "PNG" },
    { value: "jpg", label: "JPG" },
    ...(webpAvailable ? [{ value: "webp" as const, label: "WebP" }] : []),
    { value: "lumengrab", label: ".lumengrab" },
    ...(onVideo ? [{ value: "video" as const, label: "Video / GIF" }] : []),
  ];

  return (
    <Modal label="Export" onClose={onClose}>
      <div className="flex items-start justify-between gap-4">
        <div className="flex flex-col gap-1">
          <h2 className="text-lg font-semibold">Export</h2>
          <p className="text-[13px] text-muted-foreground">
            {image
              ? "Choose the format and size of the exported image."
              : "Save the capture with everything you can still edit."}
          </p>
        </div>
        <Button
          variant="ghost"
          size="icon"
          className="-mt-1 -mr-2 size-8"
          aria-label="Close"
          onClick={onClose}
        >
          <X aria-hidden />
        </Button>
      </div>

      <Section label="Format">
        <Pills
          label="Format"
          value={format}
          options={options}
          onChange={(next) => {
            if (next === "video") onVideo?.();
            else pickFormat(next);
          }}
        />
      </Section>

      {image ? (
        <>
          <Section label="Size" value={`${String(size.width)} × ${String(size.height)} px`}>
            <Pills
              label="Size"
              value={String(chip)}
              options={[
                ...SCALES.map((s) => ({ value: String(s), label: `${String(s)}×` })),
                { value: "custom", label: "Custom" },
              ]}
              onChange={(v) => {
                if (v === "custom") {
                  setCustom(true);
                } else {
                  setCustom(false);
                  setSize(sizeForScale(content, Number(v)));
                }
              }}
            />
            {custom ? (
              <div className="flex items-center gap-2">
                <SizeField
                  label="Width"
                  axis="W"
                  value={size.width}
                  onCommit={(v) => {
                    setSize(customSize(content, size, "width", v, locked));
                  }}
                />
                <Button
                  variant="ghost"
                  size="icon"
                  className="size-8"
                  aria-label="Lock ratio"
                  aria-pressed={locked}
                  onClick={() => {
                    setLocked(!locked);
                  }}
                >
                  {locked ? <Link2 aria-hidden /> : <Link2Off aria-hidden />}
                </Button>
                <SizeField
                  label="Height"
                  axis="H"
                  value={size.height}
                  onCommit={(v) => {
                    setSize(customSize(content, size, "height", v, locked));
                  }}
                />
              </div>
            ) : null}
          </Section>

          {lossy ? (
            <Section
              label="Quality"
              value={`${String(q)}%${bytes === null ? "" : ` · ${approxSize(bytes)}`}`}
            >
              <Slider
                label="Quality"
                value={q}
                min={10}
                max={100}
                onChange={(v) => {
                  setQuality((prev) => ({ ...prev, [format]: v }));
                }}
              />
              <div className="flex justify-between text-xs text-muted-foreground">
                <span>Smaller file</span>
                <span>Better quality</span>
              </div>
            </Section>
          ) : null}

          {redactions > 0 ? (
            <p className="flex gap-2 text-[13px] text-muted-foreground">
              <Info aria-hidden className="mt-0.5 size-4 shrink-0" />
              {redactionNote(redactions)}
            </p>
          ) : null}
        </>
      ) : redactions > 0 ? (
        <div
          role="note"
          className="flex gap-2.5 rounded-md border border-warning-border bg-warning-soft p-3 text-[13px]"
        >
          <ShieldAlert aria-hidden className="mt-0.5 size-4 shrink-0 text-warning" />
          <div className="flex flex-col gap-1">
            <p className="font-semibold">This file keeps your original pixels</p>
            <p className="text-muted-foreground">
              {`${String(redactions)} ${redactions === 1 ? "redaction is" : "redactions are"} saved as editable layers on top of the unredacted original. Anyone who opens the .lumengrab file can remove them. Export a flat PNG to share safely.`}
            </p>
          </div>
        </div>
      ) : (
        <p className="flex gap-2 text-[13px] text-muted-foreground">
          <FileArchive aria-hidden className="mt-0.5 size-4 shrink-0" />
          Crop, annotations and presentation are saved on top of the untouched original, so you can
          keep editing later.
        </p>
      )}

      <label className="flex flex-col gap-2">
        <span className="text-[13px] font-medium">File name</span>
        <input
          aria-label="File name"
          value={fileName}
          spellCheck={false}
          className="h-9 rounded-md border border-border bg-background px-3 text-[13px] outline-none focus-visible:ring-2 focus-visible:ring-ring"
          onChange={(e) => {
            setFileName(e.target.value);
          }}
          onKeyDown={(e) => {
            if (e.key === "Enter") {
              e.preventDefault();
              save();
            }
          }}
        />
      </label>

      <div className="flex items-center justify-end gap-2">
        {!image && redactions > 0 ? (
          <Button
            variant="outline"
            className="mr-auto"
            onClick={() => {
              pickFormat("png");
            }}
          >
            Export flat PNG instead
          </Button>
        ) : null}
        <Button variant="ghost" onClick={onClose}>
          <X aria-hidden />
          Cancel
        </Button>
        {image ? (
          <Button
            variant="outline"
            onClick={() => {
              onCopy(size);
            }}
          >
            <Copy aria-hidden />
            Copy
          </Button>
        ) : null}
        <Button data-autofocus onClick={save}>
          {image ? `Save ${{ png: "PNG", jpg: "JPG", webp: "WebP" }[format]}` : "Save .lumengrab"}
        </Button>
      </div>
    </Modal>
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
        key={value}
        defaultValue={value}
        className="min-w-0 flex-1 bg-transparent tabular-nums outline-none"
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
      <span aria-hidden className="text-muted-foreground">
        px
      </span>
    </label>
  );
}

export type { ImageFormat };
