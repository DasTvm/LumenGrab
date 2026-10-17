import { useState } from "react";
import { ChevronDown, GripVertical, Link2, Plus, RefreshCw, Trash2 } from "lucide-react";
import { cn } from "@/ui/lib/utils";
import {
  addSetting,
  moveSetting,
  removeSetting,
  uniqueName,
  updateSetting,
} from "@/shader/code-edit";
import { parsePragmas, uniformTypeOf } from "@/shader/custom";
import type { ParamSpec } from "@/shader/params";
import type { ShaderParamValue } from "@/shader/types";

const TYPES = [
  { id: "number", label: "Number" },
  { id: "int", label: "Whole" },
  { id: "color", label: "Colour" },
  { id: "bool", label: "Switch" },
  { id: "enum", label: "Choice" },
] as const;
type TypeId = (typeof TYPES)[number]["id"];

const typeLabel = (spec: ParamSpec) => TYPES.find((t) => t.id === spec.type)?.label ?? "";

function summary(spec: ParamSpec, value: ShaderParamValue | undefined): string {
  if (spec.type === "bool")
    return (typeof value === "boolean" ? value : spec.default) ? "On" : "Off";
  if (spec.type === "number" || spec.type === "int") {
    const n = typeof value === "number" ? value : spec.default;
    return n.toFixed(spec.type === "int" ? 0 : 1);
  }
  return typeof value === "string" ? value : "";
}

/** The spec of a setting changed to another type, with sensible defaults. */
function retype(spec: ParamSpec, type: TypeId): ParamSpec {
  const base = { id: spec.id, label: spec.label, group: spec.group };
  switch (type) {
    case "number":
      return { ...base, type: "number", min: 0, max: 1, step: 0.01, default: 0.5, decimals: 2 };
    case "int":
      return { ...base, type: "int", min: 0, max: 8, step: 1, default: 1, decimals: 0 };
    case "color":
      return { ...base, type: "color", default: "#C8FF2E" };
    case "bool":
      return { ...base, type: "bool", default: true };
    case "enum":
      return {
        ...base,
        type: "enum",
        options: [
          { id: "One", label: "One" },
          { id: "Two", label: "Two" },
        ],
        default: "One",
      };
    default:
      return spec;
  }
}

function Field({
  label,
  children,
  className,
}: {
  label: string;
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <label className={cn("flex min-w-0 flex-col gap-1 text-xs text-muted-foreground", className)}>
      {label}
      {children}
    </label>
  );
}

const input =
  "h-9 min-w-0 rounded-md bg-muted px-3 text-[13px] text-foreground outline-none focus-visible:ring-2 focus-visible:ring-ring";

/** A text or number box that is committed on Enter or when it loses focus. */
function Box({
  label,
  value,
  onCommit,
  readOnly,
}: {
  label: string;
  value: string;
  onCommit: (value: string) => void;
  readOnly?: boolean;
}) {
  return (
    <input
      aria-label={label}
      key={value}
      defaultValue={value}
      readOnly={readOnly}
      className={input}
      onKeyDown={(e) => {
        e.stopPropagation();
        if (e.key === "Enter") e.currentTarget.blur();
      }}
      onBlur={(e) => {
        if (e.currentTarget.value !== value) onCommit(e.currentTarget.value);
      }}
    />
  );
}

/**
 * The Settings tab of the shader editor (design: Studio / Shader editor / Settings builder): the settings
 * the code asks for, each editable here. A change here rewrites its `// @param` line (and its uniform); a
 * change in the code shows up here. Both stay in sync because the code is the only truth.
 */
export function SettingsBuilder({
  code,
  values,
  onCode,
  readOnly,
}: {
  code: string;
  values: Record<string, ShaderParamValue>;
  onCode: (code: string) => void;
  readOnly: boolean;
}) {
  const { params } = parsePragmas(code);
  const [open, setOpen] = useState<string | null>(params[0]?.spec.id ?? null);

  const change = (spec: ParamSpec, next: ParamSpec) => {
    onCode(updateSetting(code, spec.id, next));
  };

  return (
    <div className="flex min-h-0 flex-1 flex-col gap-3 overflow-y-auto p-4">
      <p className="flex items-center gap-2.5 rounded-lg bg-muted px-3 py-2.5 text-[13px] text-muted-foreground">
        <RefreshCw aria-hidden className="size-4 shrink-0" />
        Settings come from // @param lines in your code. Change them here or in the code, both stay
        in sync. Anyone using your shader sees these controls.
      </p>
      <div className="flex items-baseline justify-between text-[11px] font-semibold tracking-wide text-muted-foreground uppercase">
        <h3>Your settings</h3>
        <span className="font-normal normal-case">
          {params.length === 1 ? "1 setting" : `${String(params.length)} settings`}
        </span>
      </div>
      <ul aria-label="Settings" className="flex flex-col gap-2">
        {params.map(({ spec }, index) => {
          const expanded = open === spec.id;
          return (
            <li
              key={spec.id}
              className={cn("rounded-xl border", expanded ? "border-foreground" : "border-border")}
            >
              <div className="flex items-center gap-2.5 px-3 py-2.5">
                <span
                  role="group"
                  aria-label={`Move ${spec.id}`}
                  className="flex flex-col text-muted-foreground"
                >
                  <button
                    type="button"
                    aria-label={`Move ${spec.id} up`}
                    disabled={readOnly || index === 0}
                    className="flex h-3 items-center disabled:opacity-30"
                    onClick={() => {
                      onCode(moveSetting(code, spec.id, index - 1));
                    }}
                  >
                    <GripVertical aria-hidden className="size-3" />
                  </button>
                  <button
                    type="button"
                    aria-label={`Move ${spec.id} down`}
                    disabled={readOnly || index === params.length - 1}
                    className="flex h-3 items-center disabled:opacity-30"
                    onClick={() => {
                      onCode(moveSetting(code, spec.id, index + 1));
                    }}
                  >
                    <GripVertical aria-hidden className="size-3" />
                  </button>
                </span>
                <button
                  type="button"
                  aria-expanded={expanded}
                  aria-label={`${spec.id} setting`}
                  className="flex min-w-0 flex-1 items-center gap-2.5 text-left"
                  onClick={() => {
                    setOpen(expanded ? null : spec.id);
                  }}
                >
                  <span className="font-mono text-[13px] font-semibold">{spec.id}</span>
                  <span className="rounded-md bg-muted px-1.5 py-0.5 text-[11px] text-muted-foreground">
                    {typeLabel(spec)}
                  </span>
                  <span className="min-w-0 flex-1 truncate text-[13px] text-muted-foreground">
                    {spec.label}
                  </span>
                  <span className="text-xs text-muted-foreground tabular-nums">
                    {summary(spec, values[spec.id])}
                  </span>
                  <ChevronDown
                    aria-hidden
                    className={cn(
                      "size-4 shrink-0 text-muted-foreground",
                      expanded && "rotate-180",
                    )}
                  />
                </button>
              </div>
              {expanded ? (
                <div className="flex flex-col gap-3 px-3 pb-3">
                  <div className="grid grid-cols-2 gap-3">
                    <Field label="Label shown in the panel">
                      <Box
                        label="Label"
                        value={spec.label}
                        readOnly={readOnly}
                        onCommit={(label) => {
                          if (label.trim() !== "")
                            change(spec, { ...spec, label: label.trim().slice(0, 40) });
                        }}
                      />
                    </Field>
                    <Field label="Group">
                      <Box
                        label="Group"
                        value={spec.group}
                        readOnly={readOnly}
                        onCommit={(group) => {
                          if (group.trim() !== "")
                            change(spec, { ...spec, group: group.trim().slice(0, 40) });
                        }}
                      />
                    </Field>
                  </div>
                  <Field label="Type">
                    <div
                      role="radiogroup"
                      aria-label="Type"
                      className="flex gap-0.5 rounded-lg bg-muted p-0.5"
                    >
                      {TYPES.map((t) => (
                        <button
                          key={t.id}
                          type="button"
                          role="radio"
                          aria-checked={spec.type === t.id}
                          disabled={readOnly}
                          className={cn(
                            "h-8 flex-1 rounded-md text-[13px]",
                            spec.type === t.id
                              ? "bg-background font-medium text-foreground shadow-sm"
                              : "text-muted-foreground hover:text-foreground",
                          )}
                          onClick={() => {
                            if (spec.type !== t.id) change(spec, retype(spec, t.id));
                          }}
                        >
                          {t.label}
                        </button>
                      ))}
                    </div>
                  </Field>
                  {spec.type === "number" || spec.type === "int" ? (
                    <div className="grid grid-cols-4 gap-3">
                      {(
                        [
                          ["Default", "default"],
                          ["Smallest", "min"],
                          ["Largest", "max"],
                          ["Step", "step"],
                        ] as const
                      ).map(([label, key]) => (
                        <Field key={key} label={label}>
                          <Box
                            label={label}
                            value={String(spec[key])}
                            readOnly={readOnly || (spec.type === "int" && key === "step")}
                            onCommit={(text) => {
                              const n = Number(text.replace(",", "."));
                              if (!Number.isFinite(n)) return;
                              const next = { ...spec, [key]: n };
                              if (key === "step" && n <= 0) return;
                              change(spec, next);
                            }}
                          />
                        </Field>
                      ))}
                    </div>
                  ) : null}
                  {spec.type === "enum" ? (
                    <Field label="Options (separated by commas)">
                      <Box
                        label="Options"
                        value={spec.options.map((o) => o.id).join(", ")}
                        readOnly={readOnly}
                        onCommit={(text) => {
                          const options = text
                            .split(",")
                            .map((o) => o.trim())
                            .filter((o) => o !== "");
                          if (options.length < 2) return;
                          change(spec, {
                            ...spec,
                            options: options.map((o) => ({ id: o, label: o })),
                            default: options.includes(spec.default)
                              ? spec.default
                              : (options[0] ?? ""),
                          });
                        }}
                      />
                    </Field>
                  ) : null}
                  {spec.type === "color" ? (
                    <Field label="Default colour">
                      <Box
                        label="Default colour"
                        value={spec.default}
                        readOnly={readOnly}
                        onCommit={(text) => {
                          if (/^#[0-9a-fA-F]{6}$/.test(text))
                            change(spec, { ...spec, default: text.toUpperCase() });
                        }}
                      />
                    </Field>
                  ) : null}
                  <div className="flex items-center justify-between text-xs text-muted-foreground">
                    <span className="flex items-center gap-1.5">
                      <Link2 aria-hidden className="size-3.5" />
                      {`Linked to uniform ${uniformTypeOf(spec)} ${spec.id}; in your code`}
                    </span>
                    <button
                      type="button"
                      disabled={readOnly}
                      className="flex items-center gap-1.5 text-destructive disabled:opacity-40"
                      onClick={() => {
                        onCode(removeSetting(code, spec.id));
                        setOpen(null);
                      }}
                    >
                      <Trash2 aria-hidden className="size-3.5" /> Remove setting
                    </button>
                  </div>
                </div>
              ) : null}
            </li>
          );
        })}
      </ul>
      <button
        type="button"
        disabled={readOnly || params.length >= 16}
        className="flex h-9 w-fit items-center gap-1.5 rounded-lg border border-border bg-background px-3 text-[13px] font-medium hover:bg-muted disabled:opacity-50"
        onClick={() => {
          const id = uniqueName(code);
          onCode(
            addSetting(code, {
              id,
              label: "Setting",
              group: "Settings",
              type: "number",
              min: 0,
              max: 1,
              step: 0.01,
              default: 0.5,
              decimals: 2,
            }),
          );
          setOpen(id);
        }}
      >
        <Plus aria-hidden className="size-4" /> Add setting
      </button>
    </div>
  );
}
