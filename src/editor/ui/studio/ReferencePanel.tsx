import { useState } from "react";
import { BookOpenCheck, Check, Copy, Plus, Scale, Search } from "lucide-react";
import type { LayerRole } from "@/shader/types";

interface Entry {
  name: string;
  type: string;
  text: string;
  /** What `+` puts in the code. */
  insert: string;
  uniform?: boolean;
  effectOnly?: boolean;
}

const INPUTS: Entry[] = [
  {
    name: "u_resolution",
    type: "vec2",
    text: "Size of the background in pixels.",
    insert: "uniform vec2 u_resolution;",
    uniform: true,
  },
  {
    name: "u_phase",
    type: "float",
    text: "0 to 1, repeats every loop. Use it for all motion.",
    insert: "uniform float u_phase;",
    uniform: true,
  },
  {
    name: "u_seed",
    type: "float",
    text: "Value of the Seed field.",
    insert: "uniform float u_seed;",
    uniform: true,
  },
  {
    name: "u_palette[8]",
    type: "vec3",
    text: "The Studio palette. Count in u_palette_count.",
    insert: "uniform vec3 u_palette[8];",
    uniform: true,
  },
  {
    name: "u_input",
    type: "sampler2D",
    text: "The layers below, as a picture. Effects only.",
    insert: "uniform sampler2D u_input;",
    uniform: true,
    effectOnly: true,
  },
];

const HELPERS: Entry[] = [
  {
    name: "noise(vec2)",
    type: "float",
    text: "Smooth value noise, 0 to 1.",
    insert: "noise(uv * 4.0)",
  },
  {
    name: "fbm(vec2)",
    type: "float",
    text: "Layered noise for clouds and smoke.",
    insert: "fbm(uv * 3.0)",
  },
  {
    name: "hsv2rgb(vec3)",
    type: "vec3",
    text: "Hue, saturation, value to colour.",
    insert: "hsv2rgb(vec3(0.6, 0.7, 1.0))",
  },
  {
    name: "rot(float)",
    type: "mat2",
    text: "Rotation matrix for an angle in radians.",
    insert: "rot(0.5)",
  },
];

const EXAMPLE = [
  "// @param float speed = 1.0 [0.0, 4.0]",
  "// @param int   count = 3 [1, 8]",
  "// @param color tint = #C8FF2E",
  "// @param bool  soft = true",
].join("\n");

const RULES = [
  "One fragment shader in GLSL ES 1.00, no extensions.",
  "Write the result to gl_FragColor.",
  "Keep loops short, with fixed bounds.",
  "Only u_input may be sampled.",
];

function Item({
  entry,
  onInsert,
  onCopy,
}: {
  entry: Entry;
  onInsert: (entry: Entry) => void;
  onCopy: (text: string) => void;
}) {
  const [copied, setCopied] = useState(false);
  return (
    <li className="flex items-start justify-between gap-2">
      <div className="flex min-w-0 flex-col gap-0.5">
        <span>
          <code className="font-mono text-[13px] font-semibold">{entry.name}</code>{" "}
          <code className="font-mono text-xs text-[#3b5bdb]">{entry.type}</code>
        </span>
        <span className="text-xs text-muted-foreground">{entry.text}</span>
      </div>
      <span className="flex shrink-0 gap-1.5 text-muted-foreground">
        <button
          type="button"
          aria-label={`Insert ${entry.name}`}
          className="flex size-5 items-center justify-center rounded hover:text-foreground"
          onClick={() => {
            onInsert(entry);
          }}
        >
          <Plus aria-hidden className="size-3.5" />
        </button>
        <button
          type="button"
          aria-label={`Copy ${entry.name}`}
          className="flex size-5 items-center justify-center rounded hover:text-foreground"
          onClick={() => {
            onCopy(entry.uniform ? entry.insert : entry.name);
            setCopied(true);
            setTimeout(() => {
              setCopied(false);
            }, 1200);
          }}
        >
          {copied ? (
            <Check aria-hidden className="size-3.5" />
          ) : (
            <Copy aria-hidden className="size-3.5" />
          )}
        </button>
      </span>
    </li>
  );
}

/** The Reference tab of the shader editor (design: Studio / Shader editor / Reference). */
export function ReferencePanel({
  role,
  onInsert,
  onInsertUniform,
  onCopy,
}: {
  role: LayerRole;
  onInsert: (text: string) => void;
  onInsertUniform: (line: string) => void;
  onCopy: (text: string) => void;
}) {
  const [query, setQuery] = useState("");
  const q = query.trim().toLowerCase();
  const match = (e: Entry) => q === "" || `${e.name} ${e.type} ${e.text}`.toLowerCase().includes(q);
  const inputs = INPUTS.filter((e) => (role === "effect" || !e.effectOnly) && match(e));
  const helpers = HELPERS.filter(match);
  const insert = (entry: Entry) => {
    if (entry.uniform) onInsertUniform(entry.insert);
    else onInsert(entry.insert);
  };
  return (
    <div className="flex min-h-0 flex-1 flex-col gap-4 overflow-y-auto p-4">
      <label className="flex h-10 items-center gap-2.5 rounded-lg bg-muted px-3 text-[13px] text-muted-foreground focus-within:ring-2 focus-within:ring-ring">
        <Search aria-hidden className="size-4" />
        <input
          aria-label="Search inputs and helpers"
          placeholder="Search inputs and helpers"
          value={query}
          className="min-w-0 flex-1 bg-transparent text-foreground outline-none placeholder:text-muted-foreground"
          onChange={(e) => {
            setQuery(e.target.value);
          }}
          onKeyDown={(e) => {
            e.stopPropagation();
          }}
        />
      </label>
      <div className="grid grid-cols-2 gap-x-8 gap-y-4">
        <div className="flex flex-col gap-4">
          <section aria-label="Inputs" className="flex flex-col gap-3">
            <h3 className="text-[11px] font-semibold tracking-wide text-muted-foreground uppercase">
              Inputs
            </h3>
            <ul className="flex flex-col gap-3.5">
              {inputs.map((e) => (
                <Item key={e.name} entry={e} onInsert={insert} onCopy={onCopy} />
              ))}
            </ul>
          </section>
          <section aria-label="Helpers" className="flex flex-col gap-3">
            <h3 className="text-[11px] font-semibold tracking-wide text-muted-foreground uppercase">
              Helpers
            </h3>
            <ul className="flex flex-col gap-3.5">
              {helpers.map((e) => (
                <Item key={e.name} entry={e} onInsert={insert} onCopy={onCopy} />
              ))}
            </ul>
          </section>
          {inputs.length + helpers.length === 0 ? (
            <p className="text-[13px] text-muted-foreground">Nothing matches “{query}”.</p>
          ) : null}
        </div>
        <div className="flex flex-col gap-4">
          <section aria-label="Parameters" className="flex flex-col gap-2">
            <h3 className="text-[11px] font-semibold tracking-wide text-muted-foreground uppercase">
              Parameters
            </h3>
            <p className="text-[13px] text-muted-foreground">
              A comment above the code turns a uniform into a control.
            </p>
            <pre className="rounded-lg border border-border bg-muted/50 p-3 font-mono text-xs leading-5">
              {EXAMPLE}
            </pre>
            <p className="text-[13px] text-muted-foreground">
              Declare a uniform with the same name and type.
            </p>
          </section>
          <section aria-label="Looping" className="flex flex-col gap-2">
            <h3 className="text-[11px] font-semibold tracking-wide text-muted-foreground uppercase">
              Looping
            </h3>
            <p className="text-[13px] text-muted-foreground">
              The animation must end exactly where it starts. Drive motion with u_phase times a
              whole number of cycles, for example sin(u_phase * 6.28318 * 2.0). Never use real time.
            </p>
          </section>
          <section aria-label="Rules" className="flex flex-col gap-2">
            <h3 className="text-[11px] font-semibold tracking-wide text-muted-foreground uppercase">
              Rules
            </h3>
            <ul className="flex flex-col gap-1.5 text-[13px] text-muted-foreground">
              {RULES.map((r) => (
                <li key={r} className="flex items-start gap-2">
                  <BookOpenCheck aria-hidden className="mt-0.5 size-3.5 shrink-0 text-[#1a9b54]" />
                  {r}
                </li>
              ))}
            </ul>
          </section>
          <p className="flex items-start gap-2.5 rounded-lg bg-muted px-3 py-2.5 text-[13px] text-muted-foreground">
            <Scale aria-hidden className="mt-0.5 size-4 shrink-0" />
            Shaders from other people: check the licence first. Code from Shadertoy and similar
            sites is often not free to reuse.
          </p>
        </div>
      </div>
    </div>
  );
}
