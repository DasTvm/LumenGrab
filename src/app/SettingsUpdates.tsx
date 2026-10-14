import { useEffect, useState, type ReactNode } from "react";
import { Check, Copy, Download, Info, LoaderCircle, RefreshCw, TriangleAlert } from "lucide-react";
import { DEFAULT_SETTINGS, platform, type Os, type Settings } from "@/platform";
import { Button } from "@/ui/components/button";
import { Switch } from "@/ui/components/switch";
import { cn } from "@/ui/lib/utils";
import {
  failureText,
  lastCheckedText,
  parseReleaseNotes,
  releaseDateText,
  releaseUrl,
  remainingText,
  sizeText,
} from "@/updates/model";
import { useUpdateInfo, type UpdateView } from "@/updates/use-update-info";
import { Divider, Row, Section } from "./settings-parts";

function Panel({
  icon,
  title,
  children,
}: {
  icon: ReactNode;
  title: string;
  children?: ReactNode;
}) {
  return (
    <div className="flex gap-3.5 rounded-lg border border-border bg-card p-4">
      <span className="flex size-9 shrink-0 items-center justify-center rounded-full bg-muted">
        {icon}
      </span>
      <div className="flex min-w-0 flex-1 flex-col gap-2.5">
        <h3 className="text-base font-semibold">{title}</h3>
        {children}
      </div>
    </div>
  );
}

const Muted = ({ children }: { children: ReactNode }) => (
  <p className="text-sm text-muted-foreground">{children}</p>
);

function Bar({ fraction }: { fraction: number | null }) {
  return (
    <div
      role="progressbar"
      aria-label="Download progress"
      aria-valuemin={0}
      aria-valuemax={100}
      {...(fraction !== null ? { "aria-valuenow": Math.round(fraction * 100) } : {})}
      className="h-2 overflow-hidden rounded-full bg-muted"
    >
      <div
        className={cn("h-full rounded-full bg-brand", fraction === null && "w-1/3 animate-pulse")}
        style={fraction !== null ? { width: `${String(Math.round(fraction * 100))}%` } : undefined}
      />
    </div>
  );
}

const NOTE_TONE: Record<string, string> = {
  New: "bg-brand text-brand-foreground",
  Improved: "bg-secondary text-secondary-foreground",
  Fixed: "bg-secondary text-secondary-foreground",
};

/** The download's progress line: "24 of 38 MB · about 10 seconds left". */
function Progress({
  downloaded,
  total,
  startedAt,
  now,
}: {
  downloaded: number;
  total: number | null;
  startedAt: number | null;
  now: number;
}) {
  const left = startedAt === null ? "" : remainingText(downloaded, total, startedAt, now);
  return (
    <>
      <Bar fraction={total ? Math.min(1, downloaded / total) : null} />
      <Muted>{[sizeText(downloaded, total), left].filter(Boolean).join(" · ")}</Muted>
    </>
  );
}

function Status({
  info,
  os,
  onError,
}: {
  info: UpdateView;
  os: Os;
  onError: (message: string) => void;
}) {
  const [later, setLater] = useState(false);
  const run = (task: Promise<unknown>) => {
    task.catch((e: unknown) => {
      onError(e instanceof Error ? e.message : String(e));
    });
  };
  const state = info.state;
  switch (state.kind) {
    case "unavailable":
      return null;
    case "idle":
      return (
        <Panel icon={<RefreshCw aria-hidden className="size-4" />} title="Check for updates">
          <Muted>Look for a newer version of LumenGrab whenever you like.</Muted>
        </Panel>
      );
    case "checking":
      return (
        <Panel
          icon={<LoaderCircle aria-hidden className="size-4 animate-spin" />}
          title="Checking for updates…"
        >
          <Muted>Looking for a newer version of LumenGrab.</Muted>
          <Bar fraction={null} />
        </Panel>
      );
    case "upToDate":
      return (
        <Panel icon={<Check aria-hidden className="size-4" />} title="You're up to date">
          <Muted>{`LumenGrab ${info.currentVersion} is the latest version.`}</Muted>
        </Panel>
      );
    case "available": {
      const groups = parseReleaseNotes(state.notes);
      const date = releaseDateText(state.date);
      return (
        <Panel
          icon={<Download aria-hidden className="size-4" />}
          title={`Version ${state.version} is available`}
        >
          {date ? <Muted>{`Released ${date}`}</Muted> : null}
          {groups.length > 0 ? (
            <div
              className="flex flex-col gap-2 rounded-md bg-muted/60 p-3.5"
              aria-label={`What's new in ${state.version}`}
            >
              <h4 className="text-sm font-medium">{`What's new in ${state.version}`}</h4>
              <ul className="flex flex-col gap-1.5">
                {groups.flatMap((g) =>
                  g.items.map((item) => (
                    <li key={`${g.title}-${item}`} className="flex items-start gap-2.5 text-sm">
                      <span
                        className={cn(
                          "mt-0.5 w-[62px] shrink-0 rounded-sm px-1.5 py-px text-center text-[11px] font-medium",
                          NOTE_TONE[g.title],
                        )}
                      >
                        {g.title}
                      </span>
                      {item}
                    </li>
                  )),
                )}
              </ul>
              <p className="text-xs text-muted-foreground">
                Notes come from the release page on GitHub.
              </p>
            </div>
          ) : null}
          <div className="flex flex-wrap gap-2">
            <Button
              variant="accent"
              onClick={() => {
                run(platform.downloadUpdate());
              }}
            >
              Install and restart
            </Button>
            <Button
              variant="outline"
              onClick={() => {
                run(platform.openUrl(releaseUrl(state.version)));
              }}
            >
              See what's new
            </Button>
            <Button
              variant="ghost"
              onClick={() => {
                run(platform.skipUpdate());
              }}
            >
              Skip this version
            </Button>
          </div>
        </Panel>
      );
    }
    case "downloading":
      return (
        <Panel
          icon={<LoaderCircle aria-hidden className="size-4 animate-spin" />}
          title={`Downloading version ${state.version}`}
        >
          <Progress
            downloaded={state.downloaded}
            total={state.total}
            startedAt={info.downloadStartedAt}
            now={info.updatedAt}
          />
          <div>
            <Button
              variant="outline"
              size="sm"
              onClick={() => {
                run(platform.cancelUpdate());
              }}
            >
              Cancel
            </Button>
          </div>
        </Panel>
      );
    case "ready":
      return (
        <Panel
          icon={<Check aria-hidden className="size-4" />}
          title={`Version ${state.version} is ready`}
        >
          <Muted>
            {later
              ? "The update installs when you restart LumenGrab."
              : "Restart LumenGrab to finish the update. Open documents are saved first."}
          </Muted>
          {os === "macos" ? (
            <p className="flex gap-2 rounded-md bg-muted/60 p-3 text-sm text-muted-foreground">
              <Info aria-hidden className="mt-0.5 size-4 shrink-0" />
              After restarting, macOS may ask for Screen Recording permission again. That is normal
              for apps without an Apple developer signature.
            </p>
          ) : null}
          <div className="flex gap-2">
            <Button
              variant="accent"
              onClick={() => {
                run(platform.restartToUpdate());
              }}
            >
              Restart now
            </Button>
            {later ? null : (
              <Button
                variant="outline"
                onClick={() => {
                  setLater(true);
                }}
              >
                Later
              </Button>
            )}
          </div>
        </Panel>
      );
    case "failed": {
      const text = failureText(state.reason);
      return (
        <Panel
          icon={<TriangleAlert aria-hidden className="size-4 text-warning" />}
          title={text.title}
        >
          <Muted>{text.body}</Muted>
          <p className="text-xs text-muted-foreground">{`Details: ${state.message}`}</p>
          <div className="flex gap-2">
            <Button
              variant="accent"
              onClick={() => {
                run(platform.checkForUpdates());
              }}
            >
              Try again
            </Button>
            <Button
              variant="outline"
              onClick={() => {
                void navigator.clipboard
                  .writeText(`${text.title}: ${state.message}`)
                  .catch(() => undefined);
              }}
            >
              <Copy aria-hidden /> Copy details
            </Button>
          </div>
        </Panel>
      );
    }
  }
}

/** Settings > Updates (design): the version, the state of the check, and the daily check switch. */
export function UpdatesPage({
  settings,
  onChange,
  saveError,
}: {
  settings: Settings | null;
  onChange: (next: Settings) => void;
  saveError: string | null;
}) {
  const info = useUpdateInfo();
  const [os, setOs] = useState<Os>("other");
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    platform.getAppInfo().then(
      (app) => {
        setOs(app.os);
      },
      () => undefined,
    );
  }, []);
  const loaded = settings !== null;
  const current = settings ?? DEFAULT_SETTINGS;
  const busy = info?.state.kind === "checking" || info?.state.kind === "downloading";
  const checked = info ? lastCheckedText(info.lastChecked) : null;

  return (
    <div className="flex max-w-[836px] flex-col gap-7">
      <h1 className="text-xl font-semibold">Updates</h1>
      {saveError ? (
        <p role="alert" className="text-sm text-destructive">
          {saveError}
        </p>
      ) : null}
      {error ? (
        <p role="alert" className="text-sm text-destructive">
          {error}
        </p>
      ) : null}
      {info?.state.kind === "unavailable" ? (
        <p role="status" className="text-sm text-muted-foreground">
          Updates are not set up in this build. Get the newest version from the LumenGrab website.
        </p>
      ) : info ? (
        <Section title="Updates">
          <div className="flex items-center justify-between gap-6">
            <div className="flex flex-col gap-0.5">
              <span className="text-xs font-semibold tracking-wide text-muted-foreground uppercase">
                Version
              </span>
              <span className="text-base font-medium">{`LumenGrab ${info.currentVersion}`}</span>
              <span className="text-xs text-muted-foreground">
                {checked ? `Last checked: ${checked}` : "Not checked yet"}
              </span>
            </div>
            <Button
              variant="outline"
              disabled={busy}
              onClick={() => {
                setError(null);
                platform.checkForUpdates().catch((e: unknown) => {
                  setError(e instanceof Error ? e.message : String(e));
                });
              }}
            >
              <RefreshCw
                aria-hidden
                className={cn(info.state.kind === "checking" && "animate-spin")}
              />
              {info.state.kind === "checking" ? "Checking…" : "Check now"}
            </Button>
          </div>
          <Status info={info} os={os} onError={setError} />
        </Section>
      ) : null}
      {info?.state.kind === "unavailable" ? null : <Divider />}

      {info?.state.kind === "unavailable" ? null : (
        <Section title="Automatic updates">
          <Row
            title="Check for updates automatically"
            description="Once a day, in the background. Turn it off and LumenGrab never goes online by itself."
          >
            <Switch
              checked={current.updates.auto}
              disabled={!loaded}
              aria-label="Check for updates automatically"
              onCheckedChange={(auto) => {
                onChange({ ...current, updates: { auto } });
              }}
            />
          </Row>
          <div className="flex gap-3 rounded-lg bg-muted/60 p-4 text-sm">
            <Info aria-hidden className="mt-0.5 size-4 shrink-0 text-muted-foreground" />
            <div className="flex flex-col gap-1">
              <span className="font-medium">
                The update check is the only network access LumenGrab has.
              </span>
              <span className="text-muted-foreground">
                It asks GitHub for a small file with the latest version number. Nothing about you,
                your captures or how you use the app is sent: no account, no telemetry, no tracking.
              </span>
            </div>
          </div>
        </Section>
      )}
    </div>
  );
}
