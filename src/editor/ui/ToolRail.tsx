import { Button } from "@/ui/components/button";
import { Tooltip } from "@/ui/components/tooltip";
import { useUi, useStores } from "./context";
import { TOOL_ICONS } from "./icons";
import { TOOL_GROUPS, type ToolId } from "./tools";

interface Props {
  /** A file from a newer version: only Select stays on (design: tool rail states). */
  readOnly: boolean;
}

/** The tool rail (design: Editor, tool rail). Twelve tools in four groups; the active one is lime. */
export function ToolRail({ readOnly }: Props) {
  const { ui } = useStores();
  const active = useUi((s) => s.tool);
  const cropping = active === "crop";

  const disabledReason = (id: ToolId): string | null => {
    if (readOnly && id !== "select") return "Read-only: file from a newer version";
    if (cropping && id !== "crop") return "Finish cropping first";
    return null;
  };

  return (
    <nav
      aria-label="Tools"
      className="flex w-16 shrink-0 flex-col items-center gap-1 border-r border-border bg-card py-4"
    >
      {TOOL_GROUPS.map((group, index) => (
        <div key={group[0]?.id} className="flex flex-col items-center gap-1">
          {index > 0 ? <div className="my-1.5 h-px w-7 bg-border" /> : null}
          {group.map((tool) => {
            const Icon = TOOL_ICONS[tool.id];
            const reason = disabledReason(tool.id);
            return (
              <Tooltip
                key={tool.id}
                label={reason ?? tool.label}
                {...(reason ? {} : { shortcut: tool.key })}
              >
                <Button
                  variant="ghost"
                  size="icon"
                  active={active === tool.id}
                  aria-label={tool.label}
                  aria-keyshortcuts={tool.key}
                  disabled={reason !== null}
                  data-tool={tool.id}
                  onClick={() => {
                    ui.getState().setTool(tool.id);
                  }}
                >
                  <Icon aria-hidden />
                </Button>
              </Tooltip>
            );
          })}
        </div>
      ))}
    </nav>
  );
}
