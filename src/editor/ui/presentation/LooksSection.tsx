import { applyLook, BUILTIN_LOOKS, lookMatches, type Look } from "@/presentation/looks";
import { cn } from "@/ui/lib/utils";
import { useStores } from "../context";
import { LookThumb } from "./LookThumb";
import { usePictureWidth, usePresentation } from "./use-presentation";

/** One look in the gallery: a thumbnail on a skeleton window and its name. */
export function LookTile({
  look,
  selected,
  onApply,
}: {
  look: Look;
  selected: boolean;
  onApply: () => void;
}) {
  return (
    <button
      type="button"
      aria-pressed={selected}
      aria-label={look.name}
      className="flex min-w-0 flex-col gap-1.5 text-left text-[13px]"
      onClick={onApply}
    >
      <span
        className={cn(
          "block overflow-hidden rounded-md",
          selected ? "ring-2 ring-primary ring-offset-1 ring-offset-card" : "ring-1 ring-border",
        )}
      >
        <LookThumb look={look} width={90} height={62} />
      </span>
      <span className={cn("truncate", selected ? "font-medium" : "text-muted-foreground")}>
        {look.name}
      </span>
    </button>
  );
}

/** Looks (design): the gallery of built-in looks; one click applies it. */
export function LooksSection() {
  const { editor } = useStores();
  const { p } = usePresentation();
  const width = usePictureWidth();
  const apply = (look: Look) => {
    editor.getState().change((project) => {
      project.presentation = applyLook(project.presentation, look, width);
    });
  };
  return (
    <section aria-label="Looks" className="flex flex-col gap-3">
      <div className="flex items-center justify-between">
        <h3 className="text-[13px] font-medium">Looks</h3>
      </div>
      <div className="grid grid-cols-3 gap-2">
        {BUILTIN_LOOKS.map((look) => (
          <LookTile
            key={look.id}
            look={look}
            selected={lookMatches(p, look, width)}
            onApply={() => {
              apply(look);
            }}
          />
        ))}
      </div>
    </section>
  );
}
