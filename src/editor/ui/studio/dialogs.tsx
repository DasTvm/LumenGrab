import { useState } from "react";
import { X } from "lucide-react";
import { Button } from "@/ui/components/button";
import { Switch } from "@/ui/components/switch";
import { cn } from "@/ui/lib/utils";
import { EXAMPLES } from "@/shader/custom";
import type { LayerRole } from "@/shader/types";
import { Modal } from "../dialogs/Modal";

/** "Discard changes?" when the Studio is closed with changes (design: Studio / Dialog / Discard changes). */
export function DiscardDialog({
  name,
  onKeep,
  onDiscard,
}: {
  name: string;
  onKeep: () => void;
  onDiscard: () => void;
}) {
  return (
    <Modal label="Discard changes?" onClose={onKeep} className="w-[420px]">
      <div className="flex flex-col gap-1.5">
        <h2 className="text-base font-semibold">Discard changes?</h2>
        <p className="text-[13px] text-muted-foreground">
          {`Your changes to “${name}” will be lost. The look in your editor stays as it was.`}
        </p>
      </div>
      <div className="flex justify-end gap-2">
        <Button data-autofocus variant="outline" onClick={onKeep}>
          Keep editing
        </Button>
        <Button variant="destructive" onClick={onDiscard}>
          Discard
        </Button>
      </div>
    </Modal>
  );
}

/** "This scene is too large" (design: Studio / Dialog / Scene too large). */
export function TooLargeDialog({
  onReview,
  onCancel,
}: {
  onReview: () => void;
  onCancel: () => void;
}) {
  return (
    <Modal label="This scene is too large" onClose={onCancel} className="w-[440px]">
      <div className="flex flex-col gap-1.5">
        <h2 className="text-base font-semibold">This scene is too large</h2>
        <p className="text-[13px] text-muted-foreground">
          This scene has too many layers or effects for the preview to stay smooth. Remove a few and
          try again.
        </p>
      </div>
      <div className="flex justify-end gap-2">
        <Button variant="ghost" onClick={onCancel}>
          <X aria-hidden /> Cancel
        </Button>
        <Button data-autofocus onClick={onReview}>
          Review layers
        </Button>
      </div>
    </Modal>
  );
}

/** "New shader" (design: Studio / Shader editor / New shader): a name, generator or effect, and how to start. */
export function NewShaderDialog({
  onOpen,
  onCancel,
}: {
  onOpen: (choice: { name: string; role: LayerRole; code: string }) => void;
  onCancel: () => void;
}) {
  const [name, setName] = useState("Untitled shader");
  const [role, setRole] = useState<LayerRole>("generator");
  const [start, setStart] = useState<"blank" | "example" | "paste">("blank");
  const [example, setExample] = useState("plasma");
  const [pasted, setPasted] = useState("");
  const examples = EXAMPLES.filter((e) => !e.id.startsWith("blank"));
  const blank = EXAMPLES.find(
    (e) => e.id === (role === "effect" ? "blank-effect" : "blank-generator"),
  );
  const code =
    start === "blank"
      ? (blank?.code ?? "")
      : start === "example"
        ? (EXAMPLES.find((e) => e.id === example)?.code ?? "")
        : pasted;
  const chosen = start === "example" ? EXAMPLES.find((e) => e.id === example) : undefined;
  const effectiveRole = chosen ? chosen.role : role;
  const ready = name.trim() !== "" && code.trim() !== "";
  return (
    <Modal label="New shader" onClose={onCancel} className="w-[520px]">
      <div className="flex flex-col gap-1.5">
        <h2 className="text-base font-semibold">New shader</h2>
        <p className="text-[13px] text-muted-foreground">
          Write your own background or effect with code. It becomes a layer in your stack, with the
          settings you define.
        </p>
      </div>
      <label className="flex flex-col gap-1.5 text-[13px]">
        <span className="font-medium">Name</span>
        <input
          data-autofocus
          aria-label="Name"
          value={name}
          maxLength={40}
          className="h-9 rounded-md border border-border bg-background px-3 text-sm outline-none focus-visible:ring-2 focus-visible:ring-ring"
          onChange={(e) => {
            setName(e.target.value);
          }}
          onKeyDown={(e) => {
            e.stopPropagation();
          }}
        />
      </label>
      <div role="radiogroup" aria-label="What should it do?" className="flex flex-col gap-2">
        <span className="text-[13px] font-medium">What should it do?</span>
        <div className="grid grid-cols-2 gap-3">
          {(
            [
              ["generator", "Generator", "It draws a background by itself."],
              ["effect", "Effect", "It changes the layers below it."],
            ] as const
          ).map(([id, label, text]) => (
            <button
              key={id}
              type="button"
              role="radio"
              aria-checked={effectiveRole === id}
              className={cn(
                "flex flex-col gap-0.5 rounded-xl border px-4 py-3 text-left",
                effectiveRole === id ? "border-foreground" : "border-border hover:bg-muted",
              )}
              onClick={() => {
                setRole(id);
                if (start === "example") setStart("blank");
              }}
            >
              <span className="text-[13px] font-semibold">{label}</span>
              <span className="text-xs text-muted-foreground">{text}</span>
            </button>
          ))}
        </div>
      </div>
      <div className="flex flex-col gap-2">
        <span className="text-[13px] font-medium">Start with</span>
        <div
          role="radiogroup"
          aria-label="Start with"
          className="flex gap-0.5 rounded-lg bg-muted p-0.5"
        >
          {(
            [
              ["blank", "A blank file"],
              ["example", "An example"],
              ["paste", "Paste code"],
            ] as const
          ).map(([id, label]) => (
            <button
              key={id}
              type="button"
              role="radio"
              aria-checked={start === id}
              className={cn(
                "h-8 flex-1 rounded-md text-[13px]",
                start === id
                  ? "bg-background font-medium shadow-sm"
                  : "text-muted-foreground hover:text-foreground",
              )}
              onClick={() => {
                setStart(id);
              }}
            >
              {label}
            </button>
          ))}
        </div>
        {start === "example" ? (
          <label className="flex flex-col gap-1">
            <span className="sr-only">Example</span>
            <select
              aria-label="Example"
              value={example}
              className="h-11 rounded-lg border border-border bg-background px-3 text-[13px]"
              onChange={(e) => {
                setExample(e.target.value);
              }}
            >
              {examples.map((e) => (
                <option key={e.id} value={e.id}>
                  {`${e.name} — ${e.blurb}`}
                </option>
              ))}
            </select>
          </label>
        ) : null}
        {start === "paste" ? (
          <textarea
            aria-label="Code to paste"
            value={pasted}
            placeholder="Paste a fragment shader here"
            className="h-32 resize-none rounded-lg border border-border bg-background p-3 font-mono text-xs outline-none focus-visible:ring-2 focus-visible:ring-ring"
            onChange={(e) => {
              setPasted(e.target.value);
            }}
            onKeyDown={(e) => {
              e.stopPropagation();
            }}
          />
        ) : null}
      </div>
      <div className="flex justify-end gap-2">
        <Button variant="ghost" onClick={onCancel}>
          Cancel
        </Button>
        <Button
          disabled={!ready}
          onClick={() => {
            onOpen({ name: name.trim(), role: effectiveRole, code });
          }}
        >
          Open shader editor
        </Button>
      </div>
    </Modal>
  );
}

/** "Save to My shaders" (design: Studio / Shader editor / Save to My shaders). */
export function SaveShaderDialog({
  initialName,
  summary,
  onSave,
  onCancel,
}: {
  initialName: string;
  /** The settings as they are now, in words. */
  summary: string;
  onSave: (choice: { name: string; keepSettings: boolean }) => void;
  onCancel: () => void;
}) {
  const [name, setName] = useState(initialName);
  const [keep, setKeep] = useState(true);
  return (
    <Modal label="Save to My shaders" onClose={onCancel} className="w-[440px]">
      <div className="flex flex-col gap-1.5">
        <h2 className="text-base font-semibold">Save to My shaders</h2>
        <p className="text-[13px] text-muted-foreground">
          Keep this shader to use it again. It is stored on this computer and appears under Add &gt;
          My shaders in every look.
        </p>
      </div>
      <label className="flex flex-col gap-1.5 text-[13px]">
        <span className="font-medium">Name</span>
        <input
          data-autofocus
          aria-label="Name"
          value={name}
          maxLength={40}
          className="h-9 rounded-md border border-border bg-background px-3 text-sm outline-none focus-visible:ring-2 focus-visible:ring-ring"
          onChange={(e) => {
            setName(e.target.value);
          }}
          onKeyDown={(e) => {
            e.stopPropagation();
            if (e.key === "Enter" && name.trim() !== "")
              onSave({ name: name.trim(), keepSettings: keep });
          }}
        />
      </label>
      <div className="flex items-center justify-between gap-4">
        <div className="flex flex-col">
          <span className="text-[13px] font-medium">Keep my settings as the defaults</span>
          <span className="text-xs text-muted-foreground">{summary}</span>
        </div>
        <Switch
          aria-label="Keep my settings as the defaults"
          checked={keep}
          onCheckedChange={setKeep}
        />
      </div>
      <div className="flex justify-end gap-2">
        <Button variant="ghost" onClick={onCancel}>
          Cancel
        </Button>
        <Button
          disabled={name.trim() === ""}
          onClick={() => {
            onSave({ name: name.trim(), keepSettings: keep });
          }}
        >
          Save shader
        </Button>
      </div>
    </Modal>
  );
}
