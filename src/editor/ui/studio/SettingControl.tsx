import { RotateCcw } from "lucide-react";
import { Switch } from "@/ui/components/switch";
import { cn } from "@/ui/lib/utils";
import type { ParamSpec } from "@/shader/params";
import type { ShaderParamValue } from "@/shader/types";
import { Pills, Slider } from "../controls";
import { ColorChip, HexInput } from "../presentation/fields";
import { DecimalBox } from "./parts";

const text = (value: ShaderParamValue | undefined): string =>
  typeof value === "string" ? value : "";

/**
 * One setting of a layer you wrote, as the user of the shader sees it (number, whole number, colour, switch,
 * choice): the same controls for the Inspector, the shader editor's preview and the settings builder.
 */
export function SettingControl({
  spec,
  value,
  onChange,
  onStart,
  onEnd,
  plain = false,
}: {
  spec: ParamSpec;
  value: ShaderParamValue;
  onChange: (value: ShaderParamValue) => void;
  onStart?: () => void;
  onEnd?: () => void;
  /** Show the setting under its own name (as written in the code), not its label. */
  plain?: boolean;
}) {
  const label = plain ? spec.id : spec.label;
  switch (spec.type) {
    case "number":
    case "int": {
      const current = typeof value === "number" ? value : spec.default;
      const decimals = spec.type === "int" ? 0 : (spec.decimals ?? 2);
      return (
        <div className="flex flex-col gap-2">
          <div className="flex items-center justify-between gap-2 text-[13px]">
            <span className="text-muted-foreground">{label}</span>
            <span className="flex items-center gap-1">
              <DecimalBox
                label={spec.label}
                value={current}
                min={spec.min}
                max={spec.max}
                step={spec.step}
                decimals={decimals}
                className="w-[64px]"
                onChange={onChange}
              />
              <button
                type="button"
                aria-label={`Reset ${spec.label}`}
                disabled={current === spec.default}
                className={cn(
                  "flex size-5 items-center justify-center rounded text-muted-foreground hover:text-foreground",
                  current === spec.default && "opacity-30",
                )}
                onClick={() => {
                  onChange(spec.default);
                }}
              >
                <RotateCcw aria-hidden className="size-3" />
              </button>
            </span>
          </div>
          <Slider
            label={`${spec.label} slider`}
            value={current}
            min={spec.min}
            max={spec.max}
            step={spec.step}
            {...(onStart ? { onStart } : {})}
            {...(onEnd ? { onEnd } : {})}
            onChange={onChange}
          />
        </div>
      );
    }
    case "bool":
      return (
        <div className="flex items-center justify-between gap-3 text-[13px]">
          <span className="text-muted-foreground">{label}</span>
          <Switch
            aria-label={spec.label}
            checked={typeof value === "boolean" ? value : spec.default}
            onCheckedChange={onChange}
          />
        </div>
      );
    case "color": {
      const current = text(value) || spec.default;
      return (
        <div className="flex items-center justify-between gap-3 text-[13px]">
          <span className="text-muted-foreground">{label}</span>
          <ColorChip
            label={spec.label}
            value={current}
            size="size-7"
            onChange={onChange}
            {...(onStart ? { onStart } : {})}
            {...(onEnd ? { onEnd } : {})}
          >
            <HexInput
              label={`${spec.label} hex`}
              value={current}
              className="h-7 w-[92px]"
              onChange={onChange}
            />
          </ColorChip>
        </div>
      );
    }
    case "enum":
      return (
        <div className="flex flex-col gap-1.5 text-[13px]">
          <span className="text-muted-foreground">{label}</span>
          <Pills
            label={spec.label}
            value={text(value) || spec.default}
            options={spec.options.map((o) => ({ value: o.id, label: o.label }))}
            onChange={onChange}
          />
        </div>
      );
    case "stops":
      return null;
  }
}
