import { useEffect, useState, type ReactNode } from "react";
import { Folder, Keyboard, SlidersHorizontal } from "lucide-react";
import { formatKey, spokenShortcut } from "@/platform/keys";
import { platform, type AppInfo, type HotkeyInfo, type SettingsInfo } from "@/platform";
import { Badge } from "@/ui/components/badge";
import { Button } from "@/ui/components/button";
import { Keycap } from "@/ui/components/keycap";
import { NavItem } from "@/ui/components/nav-item";
import { Segmented } from "@/ui/components/segmented";
import { Switch } from "@/ui/components/switch";
import { readThemePreference, saveThemePreference, type ThemePreference } from "@/ui/theme";

type Page = "general" | "hotkeys";

const HOTKEY_TEXT: Record<HotkeyInfo["id"], { title: string; description: string }> = {
  area: { title: "Capture Area", description: "Select a region of the screen" },
  window: { title: "Capture Window", description: "Pick a single window" },
  fullscreen: { title: "Capture Fullscreen", description: "The whole display under the cursor" },
};

const THEME_OPTIONS = [
  { value: "system", label: "System" },
  { value: "light", label: "Light" },
  { value: "dark", label: "Dark" },
] as const satisfies readonly { value: ThemePreference; label: string }[];

/** Settings window (design: "Settings", "Settings Hotkeys"). Only options that really work are live; the rest say "Soon". */
export function SettingsWindow() {
  const [page, setPage] = useState<Page>("general");
  const [app, setApp] = useState<AppInfo | null>(null);
  const [info, setInfo] = useState<SettingsInfo | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    platform.getAppInfo().then(setApp, () => {
      setApp(null);
    });
    platform.getSettingsInfo().then(setInfo, (e: unknown) => {
      setError(e instanceof Error ? e.message : "The settings could not be loaded.");
    });
  }, []);

  return (
    <div className="flex h-screen bg-background text-foreground">
      <nav
        aria-label="Settings"
        className="flex w-[200px] shrink-0 flex-col gap-0.5 border-r border-border bg-card p-4"
      >
        <NavItem
          icon={<SlidersHorizontal />}
          active={page === "general"}
          onClick={() => {
            setPage("general");
          }}
        >
          General
        </NavItem>
        <NavItem
          icon={<Keyboard />}
          active={page === "hotkeys"}
          onClick={() => {
            setPage("hotkeys");
          }}
        >
          Hotkeys
        </NavItem>
      </nav>

      <main className="flex-1 overflow-auto p-8">
        {error ? (
          <p role="alert" className="text-sm text-destructive">
            {error}
          </p>
        ) : page === "general" ? (
          <GeneralPage info={info} />
        ) : (
          <HotkeysPage info={info} app={app} />
        )}
      </main>
    </div>
  );
}

function Row({
  title,
  description,
  children,
}: {
  title: string;
  description?: string;
  children: ReactNode;
}) {
  return (
    <div className="flex items-center justify-between gap-6">
      <div className="flex flex-col gap-0.5">
        <span className="text-base font-medium">{title}</span>
        {description ? <span className="text-xs text-muted-foreground">{description}</span> : null}
      </div>
      <div className="flex shrink-0 items-center gap-3">{children}</div>
    </div>
  );
}

function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section aria-label={title} className="flex flex-col gap-4">
      <h2 className="text-xs font-semibold tracking-wide text-muted-foreground uppercase">
        {title}
      </h2>
      {children}
    </section>
  );
}

const Divider = () => <hr className="border-border" />;

function GeneralPage({ info }: { info: SettingsInfo | null }) {
  const [theme, setTheme] = useState<ThemePreference>(readThemePreference);

  return (
    <div className="flex max-w-[836px] flex-col gap-7">
      <h1 className="text-xl font-semibold">General</h1>

      <Section title="Startup">
        <Row title="Launch at login" description="Start LumenGrab automatically when you sign in.">
          <Badge variant="secondary">Soon</Badge>
          <Switch checked={false} disabled aria-label="Launch at login" />
        </Row>
      </Section>
      <Divider />

      <Section title="Appearance">
        <Row title="Theme" description="Match your system appearance or set it manually.">
          <Segmented
            tone="neutral"
            label="Theme"
            value={theme}
            options={THEME_OPTIONS}
            onValueChange={(next) => {
              setTheme(next);
              saveThemePreference(next);
            }}
          />
        </Row>
      </Section>
      <Divider />

      <Section title="Capture">
        <Row title="Save location" description="Where new screenshots are saved.">
          <div className="flex w-[280px] items-center gap-2 rounded-md border border-border bg-background px-3 py-[7px]">
            <Folder className="size-[15px] shrink-0 text-muted-foreground" aria-hidden />
            <span className="truncate text-sm" title={info?.saveDir} data-testid="save-dir">
              {info?.saveDir ?? "…"}
            </span>
          </div>
          <Button
            variant="outline"
            size="sm"
            onClick={() => {
              void platform.openScreenshotsFolder();
            }}
          >
            Open
          </Button>
        </Row>
        <Row title="Copy to clipboard automatically" description="Always on for now.">
          <Switch checked disabled aria-label="Copy to clipboard automatically" />
        </Row>
        <Row title="Play sound on capture">
          <Badge variant="secondary">Soon</Badge>
          <Switch checked={false} disabled aria-label="Play sound on capture" />
        </Row>
      </Section>
    </div>
  );
}

function HotkeysPage({ info, app }: { info: SettingsInfo | null; app: AppInfo | null }) {
  const os = app?.os ?? "other";
  return (
    <div className="flex max-w-[836px] flex-col gap-6">
      <div className="flex flex-col gap-1">
        <h1 className="text-xl font-semibold">Hotkeys</h1>
        <p className="text-sm text-muted-foreground">
          Global shortcuts work from anywhere, even when LumenGrab is in the background.
        </p>
      </div>

      <ul className="overflow-hidden rounded-lg border border-border">
        {(info?.hotkeys ?? []).map((h) => (
          <li
            key={h.id}
            className="flex items-center justify-between gap-4 border-b border-border px-5 py-3.5 last:border-b-0"
          >
            <div className="flex flex-col gap-0.5">
              <span className="text-base font-medium">{HOTKEY_TEXT[h.id].title}</span>
              <span className="text-xs text-muted-foreground">{HOTKEY_TEXT[h.id].description}</span>
            </div>
            <div className="flex items-center gap-3">
              {h.registered ? null : (
                <Badge variant="outline" className="border-destructive text-destructive">
                  In use by another app
                </Badge>
              )}
              <span
                role="img"
                aria-label={spokenShortcut(h.keys)}
                className="flex items-center gap-1"
              >
                {h.keys.map((k) => (
                  <Keycap key={k}>{formatKey(k, os)}</Keycap>
                ))}
              </span>
            </div>
          </li>
        ))}
      </ul>

      <p className="text-xs text-muted-foreground">
        These shortcuts are fixed for now. Custom shortcuts come later.
      </p>
    </div>
  );
}
