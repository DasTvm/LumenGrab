import { useState } from "react";
import { Bookmark, Check, Image as ImageIcon, X } from "lucide-react";
import type { Presentation } from "@/document/schema";
import { Button } from "@/ui/components/button";
import { Switch } from "@/ui/components/switch";
import { cn } from "@/ui/lib/utils";
import { LOOK_PARTS, lookFromPresentation, type LookPart } from "@/presentation/looks";
import { LOOK_NAME_MAX } from "@/presentation/looks-store";
import { Modal } from "@/ui/components/modal";
import { LookThumb } from "./LookThumb";

function Checkbox({
  label,
  checked,
  onChange,
}: {
  label: string;
  checked: boolean;
  onChange: (checked: boolean) => void;
}) {
  return (
    <button
      type="button"
      role="checkbox"
      aria-checked={checked}
      className="flex items-center gap-2 text-left text-[13px]"
      onClick={() => {
        onChange(!checked);
      }}
    >
      <span
        aria-hidden
        className={cn(
          "flex size-4 items-center justify-center rounded-[4px] border",
          checked
            ? "border-primary bg-primary text-primary-foreground"
            : "border-border bg-background",
        )}
      >
        {checked ? <Check className="size-3" /> : null}
      </span>
      {label}
    </button>
  );
}

export interface SaveLookChoice {
  name: string;
  include: LookPart[];
  makeDefault: boolean;
}

/** "Save as my look" (design): a preview, the name, which parts to keep, and whether it becomes the default. */
export function SaveLookDialog({
  presentation,
  width,
  suggestedName,
  draft,
  backgroundImage,
  onSave,
  onCancel,
}: {
  presentation: Presentation;
  width: number;
  suggestedName: string;
  /** What was typed and ticked before a detour (the replace question), so going back loses nothing. */
  draft?: SaveLookChoice;
  backgroundImage: CanvasImageSource | null;
  onSave: (choice: SaveLookChoice) => void;
  onCancel: () => void;
}) {
  const [name, setName] = useState(draft?.name ?? suggestedName);
  const [include, setInclude] = useState<LookPart[]>(
    draft?.include ?? ["background", "padding", "cornerRadius", "shadow", "frame"],
  );
  const [makeDefault, setMakeDefault] = useState(draft?.makeDefault ?? false);
  const ready = name.trim() !== "" && include.length > 0;
  const animated = presentation.background.type === "shader" && include.includes("background");
  const loopSeconds = presentation.background.type === "shader" ? presentation.background.loop : 0;
  const preview = lookFromPresentation(presentation, include, width, name, "preview");
  const submit = () => {
    if (ready) onSave({ name: name.trim(), include, makeDefault });
  };
  return (
    <Modal label="Save as my look" onClose={onCancel} className="w-[460px]">
      <div className="flex flex-col gap-1.5">
        <h2 className="text-base font-semibold">Save as my look</h2>
        <p className="text-[13px] text-muted-foreground">
          Keep this background, padding, shadow and frame to reuse on any capture.
        </p>
      </div>
      <div className="relative overflow-hidden rounded-lg">
        <LookThumb look={preview} width={412} height={90} fill backgroundImage={backgroundImage} />
        {animated ? (
          <span className="absolute top-2 right-2 rounded-full bg-black/60 px-2 py-0.5 text-xs text-white">{`${String(loopSeconds)} s loop`}</span>
        ) : null}
      </div>
      <label className="flex flex-col gap-1.5 text-[13px]">
        <span className="font-medium">Name</span>
        <input
          data-autofocus
          aria-label="Name"
          value={name}
          maxLength={LOOK_NAME_MAX}
          className="h-9 rounded-md border border-border bg-background px-3 text-sm outline-none focus-visible:ring-2 focus-visible:ring-ring"
          onChange={(e) => {
            setName(e.target.value);
          }}
          onKeyDown={(e) => {
            e.stopPropagation();
            if (e.key === "Enter") submit();
          }}
        />
      </label>
      <div role="group" aria-label="Include" className="flex flex-col gap-2">
        <span className="text-[13px] font-medium">Include</span>
        <div className="grid grid-cols-2 gap-x-6 gap-y-2.5">
          {LOOK_PARTS.map((part) => (
            <Checkbox
              key={part.id}
              label={part.label}
              checked={include.includes(part.id)}
              onChange={(on) => {
                setInclude(on ? [...include, part.id] : include.filter((p) => p !== part.id));
              }}
            />
          ))}
        </div>
      </div>
      {animated ? (
        <p className="rounded-md bg-muted px-3 py-2 text-xs text-muted-foreground">
          Includes the animation. It is saved with its layers and seed, and the picture export uses
          the still frame.
        </p>
      ) : null}
      <div className="flex items-center justify-between gap-4">
        <div className="flex flex-col">
          <span className="text-[13px] font-medium">Use as my default look</span>
          <span className="text-xs text-muted-foreground">New captures start with this look.</span>
        </div>
        <Switch
          aria-label="Use as my default look"
          checked={makeDefault}
          onCheckedChange={setMakeDefault}
        />
      </div>
      <div className="flex justify-end gap-2">
        <Button variant="ghost" onClick={onCancel}>
          <X aria-hidden /> Cancel
        </Button>
        <Button disabled={!ready} onClick={submit}>
          <Bookmark aria-hidden /> Save look
        </Button>
      </div>
    </Modal>
  );
}

/** Replace and delete confirmations (design: Replace look, Delete look). */
export function ConfirmDialog({
  title,
  body,
  confirm,
  destructive,
  onConfirm,
  onCancel,
}: {
  title: string;
  body: string;
  confirm: string;
  destructive?: boolean;
  onConfirm: () => void;
  onCancel: () => void;
}) {
  return (
    <Modal label={title} onClose={onCancel} className="w-[420px]">
      <div className="flex flex-col gap-1.5">
        <h2 className="text-base font-semibold">{title}</h2>
        <p className="text-[13px] text-muted-foreground">{body}</p>
      </div>
      <div className="flex justify-end gap-2">
        <Button variant="ghost" onClick={onCancel}>
          <X aria-hidden /> Cancel
        </Button>
        <Button
          data-autofocus
          variant={destructive ? "destructive" : "default"}
          onClick={onConfirm}
        >
          {confirm}
        </Button>
      </div>
    </Modal>
  );
}

/** "Use this frame as picture?" (design: Studio / Dialog / Use frame as picture). */
export function FreezeDialog({
  url,
  seconds,
  onConfirm,
  onCancel,
}: {
  url: string;
  seconds: number;
  onConfirm: (keepAnimation: boolean) => void;
  onCancel: () => void;
}) {
  const [keep, setKeep] = useState(false);
  return (
    <Modal label="Use this frame as picture?" onClose={onCancel} className="w-[460px]">
      <div className="flex flex-col gap-1.5">
        <h2 className="text-base font-semibold">Use this frame as picture?</h2>
        <p className="text-[13px] text-muted-foreground">
          The animation is replaced by this picture. You can undo this.
        </p>
      </div>
      <div className="relative overflow-hidden rounded-lg border border-border bg-muted">
        <img
          src={url}
          alt="The frame that becomes the background"
          className="h-40 w-full object-cover"
        />
        <span className="absolute bottom-2 left-2 rounded-full bg-black/60 px-2 py-0.5 text-xs text-white">{`Still frame · ${seconds.toFixed(1)} s`}</span>
      </div>
      <div className="flex items-center justify-between gap-4">
        <div className="flex flex-col">
          <span className="text-[13px] font-medium">Keep the animation as my look</span>
          <span className="text-xs text-muted-foreground">
            It is saved under Your animated looks, so you can use it again.
          </span>
        </div>
        <Switch
          aria-label="Keep the animation as my look"
          checked={keep}
          onCheckedChange={setKeep}
        />
      </div>
      <div className="flex justify-end gap-2">
        <Button variant="ghost" onClick={onCancel}>
          <X aria-hidden /> Cancel
        </Button>
        <Button
          data-autofocus
          onClick={() => {
            onConfirm(keep);
          }}
        >
          <ImageIcon aria-hidden /> Use as picture
        </Button>
      </div>
    </Modal>
  );
}
