import { cn } from "@/ui/lib/utils";
import { useStores, useUi, useEditor } from "./context";
import { LayersPanel } from "./LayersPanel";
import { StylePanel } from "./StylePanel";
import type { PanelTab } from "./ui-store";

/** The right panel (design): the Style and Layers tabs. */
export function RightPanel({ readOnly }: { readOnly: boolean }) {
  const { ui } = useStores();
  const tab = useUi((s) => s.tab);
  const layerCount = useEditor((s) => s.project.layers.length);
  const tabs: { id: PanelTab; label: string }[] = [
    { id: "style", label: "Style" },
    { id: "layers", label: layerCount > 0 ? `Layers · ${String(layerCount)}` : "Layers" },
  ];
  return (
    <aside
      aria-label="Inspector"
      className="flex w-80 shrink-0 flex-col gap-3 border-l border-border bg-card p-4"
    >
      <div
        role="tablist"
        aria-label="Panel"
        className="grid grid-cols-2 gap-1 rounded-md bg-muted p-1"
      >
        {tabs.map((t) => (
          <button
            key={t.id}
            type="button"
            role="tab"
            aria-selected={tab === t.id}
            className={cn(
              "rounded-md px-3 py-1 text-[13px] font-medium",
              tab === t.id
                ? "bg-background text-foreground"
                : "text-muted-foreground hover:text-foreground",
            )}
            onClick={() => {
              ui.getState().setTab(t.id);
            }}
          >
            {t.label}
          </button>
        ))}
      </div>
      {tab === "style" ? <StylePanel readOnly={readOnly} /> : <LayersPanel />}
    </aside>
  );
}
