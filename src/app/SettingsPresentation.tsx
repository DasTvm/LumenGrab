import { allowAllCode, setCodeGate } from "@/shader/trust";
import { useEffect, useState } from "react";
import { Pencil, Trash2 } from "lucide-react";
import { DEFAULT_SETTINGS, type Settings } from "@/platform";
import { Segmented } from "@/ui/components/segmented";
import { Switch } from "@/ui/components/switch";
import {
  BASIC_ASPECTS,
  SOCIAL_PRESETS,
  aspectOfBasic,
  aspectOfSocial,
} from "@/presentation/aspect-presets";
import { BUILTIN_LOOKS, builtinById, type Look } from "@/presentation/looks";
import { FACTORY_LOOK_ID } from "@/editor/ui/mode";
import { ConfirmDialog } from "@/editor/ui/presentation/dialogs";
import { looksStore, useLooks } from "@/editor/ui/presentation/looks-instance";
import { LookThumb } from "@/editor/ui/presentation/LookThumb";
import { cn } from "@/ui/lib/utils";
import { Divider, Row, Section } from "./settings-parts";

/** The id of the aspect choice a look has: `auto`, a basic ratio, a social preset. */
function aspectChoice(look: Look): string {
  const a = look.parts.aspect;
  if (!a || a.mode === "free") return "auto";
  if (a.preset) return a.preset;
  const hit = BASIC_ASPECTS.find(
    (b) => b.ratio && a.ratio && b.ratio[0] === a.ratio[0] && b.ratio[1] === a.ratio[1],
  );
  return hit?.id ?? "auto";
}

function withAspect(look: Look, choice: string): Look {
  const parts = { ...look.parts };
  const social = SOCIAL_PRESETS.find((p) => p.id === choice);
  const basic = BASIC_ASPECTS.find((b) => b.id === choice);
  if (social) parts.aspect = aspectOfSocial(social);
  else if (basic?.ratio) parts.aspect = aspectOfBasic(basic);
  else delete parts.aspect;
  return { ...look, parts };
}

function Tile({ look, selected, onPick }: { look: Look; selected: boolean; onPick: () => void }) {
  return (
    <button
      type="button"
      aria-pressed={selected}
      aria-label={look.name}
      className="flex min-w-0 flex-col gap-1.5 text-left text-[13px]"
      onClick={onPick}
    >
      <span
        className={cn(
          "block w-fit overflow-hidden rounded-md",
          selected
            ? "ring-2 ring-primary ring-offset-1 ring-offset-background"
            : "ring-1 ring-border",
        )}
      >
        <LookThumb look={look} width={140} height={84} />
      </span>
      <span className={cn("truncate", selected ? "font-medium" : "text-muted-foreground")}>
        {look.name}
      </span>
    </button>
  );
}

/** Settings > Presentation (design): the default look with a preview, what happens to new captures, and my looks. */
export function PresentationPage({
  settings,
  onChange,
  saveError,
}: {
  settings: Settings | null;
  onChange: (next: Settings) => void;
  saveError: string | null;
}) {
  const loaded = settings !== null;
  const current = settings ?? DEFAULT_SETTINGS;
  const own = useLooks((s) => s.looks);
  const defaultLook = useLooks((s) => s.defaultLook);
  useEffect(() => {
    // The previews draw the user's own looks: their code may run here.
    setCodeGate(allowAllCode);
    void looksStore.getState().init();
  }, []);
  const [renaming, setRenaming] = useState<string | null>(null);
  const [deleting, setDeleting] = useState<Look | null>(null);

  const factory = builtinById(FACTORY_LOOK_ID);
  const active = defaultLook ?? factory;
  const set = (patch: Partial<Settings["presentation"]>) => {
    onChange({ ...current, presentation: { ...current.presentation, ...patch } });
  };

  return (
    <div className="flex max-w-[836px] flex-col gap-7">
      <h1 className="text-xl font-semibold">Presentation</h1>
      {saveError ? (
        <p role="alert" className="text-sm text-destructive">
          {saveError}
        </p>
      ) : null}

      <Section title="Default look">
        <div className="flex gap-6">
          <div className="flex w-[360px] shrink-0 flex-col gap-2">
            {active ? (
              <div
                className="overflow-hidden rounded-lg border border-border"
                data-testid="default-preview"
              >
                <LookThumb look={active} width={358} height={224} fill />
              </div>
            ) : null}
            <p className="text-xs text-muted-foreground">
              {`${active?.name ?? ""} · preview. Used for every new capture, until you pick another look in the editor.`}
            </p>
          </div>
          <div
            className="grid flex-1 grid-cols-3 content-start gap-x-3 gap-y-3"
            role="group"
            aria-label="Default look"
          >
            {[...BUILTIN_LOOKS, ...own].map((look) => (
              <Tile
                key={look.id}
                look={look}
                selected={active?.id === look.id}
                onPick={() => {
                  void looksStore.getState().setDefault(look);
                }}
              />
            ))}
          </div>
        </div>
      </Section>
      <Divider />

      <Section title="New captures">
        <Row
          title="Apply the default look automatically"
          description="Every new capture gets your default look: in the saved file, on the clipboard and when you drag it out. The original is kept for 30 days so you can still edit it."
        >
          <Switch
            checked={current.presentation.auto}
            disabled={!loaded}
            aria-label="Apply the default look automatically"
            onCheckedChange={(auto) => {
              set({ auto });
            }}
          />
        </Row>
        <Row title="Open the editor in" description="Which mode a new capture starts in.">
          <Segmented
            tone="neutral"
            label="Open the editor in"
            disabled={!loaded}
            value={current.presentation.openInPresentation ? "presentation" : "annotate"}
            options={[
              { value: "annotate", label: "Annotate" },
              { value: "presentation", label: "Presentation" },
            ]}
            onValueChange={(mode) => {
              set({ openInPresentation: mode === "presentation" });
            }}
          />
        </Row>
        <Row title="Default aspect ratio" description="Auto keeps the shape of your capture.">
          <select
            aria-label="Default aspect ratio"
            className="h-9 w-[200px] rounded-md border border-border bg-background px-3 text-sm outline-none focus-visible:ring-2 focus-visible:ring-ring"
            disabled={!active}
            value={active ? aspectChoice(active) : "auto"}
            onChange={(e) => {
              if (active) void looksStore.getState().setDefault(withAspect(active, e.target.value));
            }}
          >
            <optgroup label="Basic">
              {BASIC_ASPECTS.map((b) => (
                <option key={b.id} value={b.id}>
                  {b.label}
                </option>
              ))}
            </optgroup>
            <optgroup label="Social">
              {SOCIAL_PRESETS.map((p) => (
                <option key={p.id} value={p.id}>
                  {`${p.platform} · ${p.label}`}
                </option>
              ))}
            </optgroup>
          </select>
        </Row>
      </Section>
      <Divider />

      <Section title="My looks">
        {own.length === 0 ? (
          <p className="text-sm text-muted-foreground">
            You have not saved a look yet. In the editor, open the Presentation tab and choose “Save
            as my look”. Looks stay on this device and are never uploaded.
          </p>
        ) : (
          <ul className="flex flex-col overflow-hidden rounded-lg border border-border">
            {own.map((look) => (
              <li
                key={look.id}
                className="flex items-center gap-3 border-b border-border px-4 py-2.5 last:border-b-0"
              >
                <span className="overflow-hidden rounded-sm ring-1 ring-border">
                  <LookThumb look={look} width={48} height={32} />
                </span>
                {renaming === look.id ? (
                  <input
                    aria-label="Look name"
                    defaultValue={look.name}
                    maxLength={40}
                    autoFocus
                    className="h-8 min-w-0 flex-1 rounded-md border border-border bg-background px-2 text-sm outline-none focus-visible:ring-2 focus-visible:ring-ring"
                    onKeyDown={(e) => {
                      if (e.key === "Enter") e.currentTarget.blur();
                      if (e.key === "Escape") {
                        e.currentTarget.value = look.name;
                        e.currentTarget.blur();
                      }
                    }}
                    onBlur={(e) => {
                      setRenaming(null);
                      const name = e.currentTarget.value.trim();
                      if (name && name !== look.name)
                        void looksStore.getState().renameLook(look.id, name);
                    }}
                  />
                ) : (
                  <span className="min-w-0 flex-1 truncate text-sm">{look.name}</span>
                )}
                <button
                  type="button"
                  aria-label={`Rename ${look.name}`}
                  className="rounded-md p-1.5 text-muted-foreground hover:bg-muted"
                  onClick={() => {
                    setRenaming(look.id);
                  }}
                >
                  <Pencil aria-hidden className="size-4" />
                </button>
                <button
                  type="button"
                  aria-label={`Delete ${look.name}`}
                  className="rounded-md p-1.5 text-destructive hover:bg-muted"
                  onClick={() => {
                    setDeleting(look);
                  }}
                >
                  <Trash2 aria-hidden className="size-4" />
                </button>
              </li>
            ))}
          </ul>
        )}
      </Section>
      {deleting ? (
        <ConfirmDialog
          title={`Delete “${deleting.name}”?`}
          body="The look is removed from your list. Captures you already edited keep their settings."
          confirm="Delete"
          destructive
          onCancel={() => {
            setDeleting(null);
          }}
          onConfirm={() => {
            const { id } = deleting;
            setDeleting(null);
            void looksStore.getState().removeLook(id);
          }}
        />
      ) : null}
    </div>
  );
}
