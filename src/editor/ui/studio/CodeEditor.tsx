import {
  forwardRef,
  useCallback,
  useEffect,
  useImperativeHandle,
  useMemo,
  useRef,
  useState,
} from "react";
import { cn } from "@/ui/lib/utils";
import { lineAndColumn, tidy, tokenizeLine, type TokenKind } from "@/shader/highlight";

const LINE = 21;
const COLORS: Record<TokenKind, string> = {
  comment: "text-[#8b8b95]",
  directive: "text-[#a855f7]",
  keyword: "text-[#3b5bdb]",
  type: "text-[#3b5bdb]",
  number: "text-[#e8710a]",
  builtin: "text-[#1a9b54]",
  plain: "text-foreground",
};

export interface CodeEditorHandle {
  /** Puts text at the cursor (replacing the selection). */
  insert(text: string): void;
  /** Adds a line after the last line that starts with `prefix` (or at the top when there is none). */
  insertAfterLast(prefix: RegExp, line: string): void;
  focus(): void;
  undo(): void;
  redo(): void;
  tidy(): void;
  /** Selects the next match of `query` after the cursor (wrapping round); false when there is none. */
  find(query: string): boolean;
  canUndo(): boolean;
  canRedo(): boolean;
}

interface Props {
  value: string;
  onChange: (value: string) => void;
  readOnly?: boolean;
  /** 1 based line with an error, shown red. */
  errorLine?: number | null;
  onCursor?: (position: { line: number; column: number }) => void;
  /** Called when undo or redo availability may have changed. */
  onHistory?: () => void;
}

/**
 * The code editor of the shader editor: a plain textarea with our own colouring laid under its text, line
 * numbers, undo and redo of its own (the browser's does not survive our edits), Tab for two spaces and Enter that
 * keeps the indent. No dependency, nothing to load.
 */
export const CodeEditor = forwardRef<CodeEditorHandle, Props>(function CodeEditor(
  { value, onChange, readOnly = false, errorLine = null, onCursor, onHistory },
  ref,
) {
  const area = useRef<HTMLTextAreaElement>(null);
  const past = useRef<string[]>([]);
  const future = useRef<string[]>([]);
  const lastTyped = useRef(0);
  const [cursorLine, setCursorLine] = useState(1);
  const lines = useMemo(() => value.split("\n"), [value]);
  const width = Math.max(...lines.map((l) => l.length), 40) + 4;

  const report = useCallback(() => {
    const el = area.current;
    if (!el) return;
    const at = lineAndColumn(el.value, el.selectionStart);
    setCursorLine(at.line);
    onCursor?.(at);
  }, [onCursor]);

  const set = useCallback(
    (next: string, caret: number, coalesce = false) => {
      if (next === value) return;
      const now = Date.now();
      if (!(coalesce && now - lastTyped.current < 600 && past.current.length > 0)) {
        past.current = [...past.current.slice(-199), value];
      }
      lastTyped.current = now;
      future.current = [];
      onChange(next);
      onHistory?.();
      requestAnimationFrame(() => {
        const el = area.current;
        if (el) {
          el.setSelectionRange(caret, caret);
          report();
        }
      });
    },
    [value, onChange, onHistory, report],
  );

  useImperativeHandle(
    ref,
    () => ({
      insert: (text) => {
        const el = area.current;
        if (!el || readOnly) return;
        const a = el.selectionStart;
        const b = el.selectionEnd;
        set(`${value.slice(0, a)}${text}${value.slice(b)}`, a + text.length);
        el.focus();
      },
      insertAfterLast: (prefix, line) => {
        if (readOnly) return;
        const all = value.split("\n");
        let at = -1;
        all.forEach((l, i) => {
          if (prefix.test(l)) at = i;
        });
        all.splice(at + 1, 0, line);
        set(all.join("\n"), all.slice(0, at + 2).join("\n").length);
      },
      focus: () => {
        area.current?.focus();
      },
      undo: () => {
        const previous = past.current.at(-1);
        if (previous === undefined || readOnly) return;
        past.current = past.current.slice(0, -1);
        future.current = [value, ...future.current];
        onChange(previous);
        onHistory?.();
      },
      redo: () => {
        const next = future.current[0];
        if (next === undefined || readOnly) return;
        future.current = future.current.slice(1);
        past.current = [...past.current, value];
        onChange(next);
        onHistory?.();
      },
      tidy: () => {
        if (!readOnly) set(tidy(value), 0);
      },
      find: (query) => {
        const el = area.current;
        if (!el || query === "") return false;
        const haystack = value.toLowerCase();
        const needle = query.toLowerCase();
        let at = haystack.indexOf(needle, el.selectionEnd);
        if (at < 0) at = haystack.indexOf(needle);
        if (at < 0) return false;
        el.focus();
        el.setSelectionRange(at, at + needle.length);
        report();
        return true;
      },
      canUndo: () => past.current.length > 0,
      canRedo: () => future.current.length > 0,
    }),
    [value, readOnly, set, onChange, onHistory, report],
  );

  // A value that is replaced from outside (an example, the settings builder) is not part of the typing history.
  const seen = useRef(value);
  useEffect(() => {
    seen.current = value;
  }, [value]);

  const onKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    e.stopPropagation();
    const el = e.currentTarget;
    const mod = e.metaKey || e.ctrlKey;
    if (mod && e.key.toLowerCase() === "z") {
      e.preventDefault();
      const previous = past.current.at(-1);
      if (e.shiftKey) {
        const next = future.current[0];
        if (next === undefined) return;
        future.current = future.current.slice(1);
        past.current = [...past.current, value];
        onChange(next);
      } else if (previous !== undefined) {
        past.current = past.current.slice(0, -1);
        future.current = [value, ...future.current];
        onChange(previous);
      }
      onHistory?.();
      return;
    }
    if (readOnly) return;
    if (e.key === "Tab") {
      e.preventDefault();
      const a = el.selectionStart;
      set(`${value.slice(0, a)}  ${value.slice(el.selectionEnd)}`, a + 2, true);
    } else if (e.key === "Enter" && !mod) {
      e.preventDefault();
      const a = el.selectionStart;
      const before = value.slice(0, a);
      const indent = /^[ \t]*/.exec(before.slice(before.lastIndexOf("\n") + 1))?.[0] ?? "";
      const extra = /\{\s*$/.test(before) ? "  " : "";
      const insert = `\n${indent}${extra}`;
      set(`${before}${insert}${value.slice(el.selectionEnd)}`, a + insert.length);
    }
  };

  return (
    <div
      className="relative min-h-0 flex-1 overflow-auto bg-background font-mono text-[12.5px]"
      style={{ lineHeight: `${String(LINE)}px` }}
    >
      <div
        className="relative flex min-h-full"
        style={{ width: `calc(52px + ${String(width)}ch)` }}
      >
        <div
          aria-hidden
          className="sticky left-0 z-10 flex w-[52px] shrink-0 flex-col bg-background pt-3 pr-3 text-right text-muted-foreground select-none"
        >
          {lines.map((_, i) => (
            <span
              key={i}
              className={cn(
                i + 1 === errorLine && "bg-destructive/15 text-destructive",
                i + 1 === cursorLine && i + 1 !== errorLine && "text-foreground",
              )}
            >
              {i + 1}
            </span>
          ))}
        </div>
        <div className="relative flex-1 pt-3">
          {errorLine ? (
            <div
              aria-hidden
              className="absolute right-0 left-0 bg-destructive/10"
              style={{ top: 12 + (errorLine - 1) * LINE, height: LINE }}
            />
          ) : null}
          {!errorLine || cursorLine !== errorLine ? (
            <div
              aria-hidden
              className="absolute right-0 left-0 bg-muted/60"
              style={{ top: 12 + (cursorLine - 1) * LINE, height: LINE }}
            />
          ) : null}
          <pre
            aria-hidden
            className="pointer-events-none relative m-0 whitespace-pre"
            data-testid="code-highlight"
          >
            {lines.map((line, i) => (
              <div key={i} style={{ height: LINE }}>
                {tokenizeLine(line).map((t, j) => (
                  <span key={j} className={COLORS[t.kind]}>
                    {t.text}
                  </span>
                ))}
                {line === "" ? " " : null}
              </div>
            ))}
          </pre>
          <textarea
            ref={area}
            aria-label="Shader code"
            spellCheck={false}
            autoCapitalize="off"
            autoCorrect="off"
            readOnly={readOnly}
            value={value}
            wrap="off"
            className="absolute top-3 left-0 m-0 block resize-none overflow-hidden border-0 bg-transparent p-0 font-mono text-[12.5px] text-transparent caret-foreground outline-none"
            style={{
              lineHeight: `${String(LINE)}px`,
              height: lines.length * LINE + LINE,
              width: "100%",
              tabSize: 2,
            }}
            onChange={(e) => {
              set(e.target.value, e.target.selectionStart, true);
            }}
            onKeyDown={onKeyDown}
            onKeyUp={report}
            onClick={report}
            onSelect={report}
          />
        </div>
      </div>
    </div>
  );
});
