import { useEffect } from "react";
import { Copy, ExternalLink, LoaderCircle, ScanText, TriangleAlert, X } from "lucide-react";
import { platform } from "@/platform";
import { Button } from "@/ui/components/button";
import { cn } from "@/ui/lib/utils";
import { useStores, useUi } from "./context";
import { codeName, isWebLink, summary, textToCopy } from "./text-read";

const HINT = "Reads the image as exported. Redacted text is not read.";

/**
 * The Text panel (design: "M6 / Editor text"): what reading the picture found, as blocks you can pick
 * on the picture or in the list, and the QR codes with their address. It replaces the style panel while
 * it is open.
 */
export function TextPanel() {
  const { session, ui } = useStores();
  const text = useUi((s) => s.text);

  // Esc closes the panel (a dialog on top handles Esc first).
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "Escape") return;
      if ((e.target as HTMLElement | null)?.closest("input, textarea, [contenteditable=true]"))
        return;
      session.closeText();
    };
    window.addEventListener("keydown", onKey);
    return () => {
      window.removeEventListener("keydown", onKey);
    };
  }, [session]);

  if (!text) return null;
  return (
    <div className="flex min-h-0 flex-1 flex-col gap-3" data-testid="text-panel">
      <div className="flex items-start justify-between gap-2">
        <div className="flex min-w-0 flex-col gap-0.5">
          <div className="flex items-center gap-2">
            <h2 className="text-base font-semibold">Text</h2>
            <span className="rounded-full bg-muted px-2 py-0.5 text-[11px] text-muted-foreground">
              Auto
            </span>
          </div>
          <p className="text-xs text-muted-foreground" aria-live="polite">
            {text.status === "reading"
              ? "Reading…"
              : text.status === "done"
                ? text.selected.length > 0
                  ? `${String(text.selected.length)} of ${String(text.result.blocks.length)} selected`
                  : summary(text.result)
                : text.status === "empty"
                  ? "Nothing to read"
                  : text.noLanguagePack
                    ? "Needs a language pack"
                    : "Could not read"}
          </p>
        </div>
        <button
          type="button"
          aria-label="Close text panel"
          className="rounded p-1 text-muted-foreground outline-none hover:bg-muted focus-visible:ring-2 focus-visible:ring-ring"
          onClick={() => {
            session.closeText();
          }}
        >
          <X className="size-4" aria-hidden />
        </button>
      </div>

      <div className="flex min-h-0 flex-1 flex-col gap-3 overflow-y-auto">
        {text.status === "reading" ? (
          <div
            role="status"
            aria-busy="true"
            className="flex items-center gap-2 rounded-md border border-border p-3 text-sm text-muted-foreground"
          >
            <LoaderCircle className="size-4 animate-spin" aria-hidden />
            Reading… on this device, nothing is sent anywhere
          </div>
        ) : null}

        {text.status === "empty" ? (
          <Message
            icon={<ScanText className="size-5" aria-hidden />}
            title="No text found"
            body="The picture has no text we can read. Try a larger area or a sharper picture."
            action={{
              label: "Read again",
              run: () => {
                void session.readText({ copy: false });
              },
            }}
          />
        ) : null}

        {text.status === "error" && !text.noLanguagePack ? (
          <Message
            icon={<TriangleAlert className="size-5" aria-hidden />}
            title="Could not read the text"
            body="Text recognition failed. Nothing was copied. Your picture is not changed."
            action={{
              label: "Try again",
              run: () => {
                void session.readText({ copy: false });
              },
            }}
          />
        ) : null}

        {text.status === "error" && text.noLanguagePack ? (
          <Message
            icon={<TriangleAlert className="size-5" aria-hidden />}
            title="No language pack for text recognition"
            body="Windows needs one to read text. It is a free download from Microsoft. Nothing leaves your computer."
            action={{
              label: "Open language settings",
              run: () => {
                void platform.openLanguageSettings();
              },
            }}
            footnote="After installing, come back and press Read again."
            second={{
              label: "Read again",
              run: () => {
                void session.readText({ copy: false });
              },
            }}
          />
        ) : null}

        {text.status === "done" ? (
          <>
            {text.result.codes.length > 0 ? (
              <section aria-label="Codes" className="flex flex-col gap-2">
                <h3 className="text-[11px] font-semibold tracking-wide text-muted-foreground uppercase">
                  Codes
                </h3>
                {text.result.codes.map((code, i) => {
                  const link = isWebLink(code.value);
                  return (
                    <div
                      key={`${String(i)}-${code.value}`}
                      data-testid="text-code"
                      className="flex flex-col gap-2 rounded-md border border-border p-3"
                    >
                      <div className="flex flex-col gap-0.5">
                        <span className="text-xs font-medium">
                          {codeName(text.result.codes, i)}
                          <span className="ml-2 font-normal text-muted-foreground">
                            {link ? "Link" : "Text"}
                          </span>
                        </span>
                        <span className="text-xs break-all text-muted-foreground">
                          {code.value}
                        </span>
                      </div>
                      <div className="flex gap-2">
                        {link ? (
                          <Button
                            variant="outline"
                            size="sm"
                            onClick={() => {
                              session.askToOpenLink(code.value);
                            }}
                          >
                            <ExternalLink aria-hidden /> Open link
                          </Button>
                        ) : null}
                        <Button
                          variant="outline"
                          size="sm"
                          aria-label={`Copy ${codeName(text.result.codes, i)}`}
                          onClick={() => {
                            void session.copyCode(code.value);
                          }}
                        >
                          <Copy aria-hidden /> Copy
                        </Button>
                      </div>
                    </div>
                  );
                })}
              </section>
            ) : null}

            <section aria-label="Text blocks" className="flex flex-col gap-2">
              {text.result.codes.length > 0 ? (
                <h3 className="text-[11px] font-semibold tracking-wide text-muted-foreground uppercase">
                  Text
                  <span className="ml-2 font-normal normal-case">
                    {text.result.blocks.length === 0
                      ? "No other text found"
                      : `${String(text.result.blocks.length)} blocks`}
                  </span>
                </h3>
              ) : null}
              {text.result.blocks.map((block, i) => {
                const on = text.selected.includes(i);
                return (
                  <button
                    key={`${String(i)}-${block.text}`}
                    type="button"
                    aria-pressed={on}
                    data-testid="text-block"
                    onClick={() => {
                      ui.getState().toggleTextBlock(i);
                    }}
                    className={cn(
                      "rounded-md border px-3 py-2 text-left text-[13px] whitespace-pre-line outline-none focus-visible:ring-2 focus-visible:ring-ring",
                      on
                        ? "border-2 border-primary bg-brand/15"
                        : "border-border hover:bg-muted/60",
                    )}
                  >
                    {block.text}
                  </button>
                );
              })}
            </section>
          </>
        ) : null}
      </div>

      <p className="text-[11px] text-muted-foreground">{HINT}</p>
      {text.status === "done" && text.result.blocks.length > 0 ? (
        <div className="flex gap-2">
          {text.selected.length > 0 ? (
            <Button
              variant="accent"
              className="flex-1"
              onClick={() => {
                void session.copyBlocks();
              }}
            >
              <Copy aria-hidden /> {`Copy selection (${String(text.selected.length)})`}
            </Button>
          ) : null}
          <Button
            variant={text.selected.length > 0 ? "outline" : "accent"}
            className={text.selected.length > 0 ? "" : "flex-1"}
            onClick={() => {
              void session.copyReadText(textToCopy(text.result, []));
            }}
          >
            <Copy aria-hidden /> {text.result.codes.length > 0 ? "Copy all text" : "Copy all"}
          </Button>
        </div>
      ) : null}
    </div>
  );
}

function Message({
  icon,
  title,
  body,
  action,
  second,
  footnote,
}: {
  icon: React.ReactNode;
  title: string;
  body: string;
  action: { label: string; run: () => void };
  second?: { label: string; run: () => void };
  footnote?: string;
}) {
  return (
    <div role="alert" className="flex flex-col gap-3 rounded-md border border-border p-4">
      <div className="flex items-center gap-2 text-muted-foreground">{icon}</div>
      <div className="flex flex-col gap-1">
        <h3 className="text-sm font-semibold">{title}</h3>
        <p className="text-xs text-muted-foreground">{body}</p>
      </div>
      <div className="flex flex-wrap gap-2">
        <Button variant="outline" size="sm" onClick={action.run}>
          {action.label}
        </Button>
        {second ? (
          <Button variant="ghost" size="sm" onClick={second.run}>
            {second.label}
          </Button>
        ) : null}
      </div>
      {footnote ? <p className="text-[11px] text-muted-foreground">{footnote}</p> : null}
    </div>
  );
}
