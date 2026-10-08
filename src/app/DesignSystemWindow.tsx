import { useState } from "react";
import { Crop, Image, MousePointer2, Pin, Save, X } from "lucide-react";
import { Badge } from "@/ui/components/badge";
import { Button } from "@/ui/components/button";
import { Card, CardHeader } from "@/ui/components/card";
import { Field } from "@/ui/components/input";
import { NavItem } from "@/ui/components/nav-item";
import { Segmented } from "@/ui/components/segmented";
import { Switch } from "@/ui/components/switch";
import { Keycap } from "@/ui/components/keycap";

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="flex flex-col gap-3">
      <h2 className="text-xs font-medium text-muted-foreground">{title}</h2>
      {children}
    </section>
  );
}

/** Dev-only gallery of the design system (`?window=design`, browser mock mode). Mirrors the "Design System" frame in LumenGrab.pen. */
export function DesignSystemWindow() {
  const [on, setOn] = useState(true);
  const [tab, setTab] = useState("annotate");
  return (
    <main className="flex min-h-screen flex-col gap-8 bg-background p-8 text-foreground">
      <Section title="Buttons">
        <div className="flex flex-wrap gap-3">
          {(["default", "accent", "secondary", "outline", "ghost", "destructive"] as const).map(
            (v) => (
              <Button key={v} variant={v}>
                <Save />
                Button
              </Button>
            ),
          )}
        </div>
      </Section>
      <Section title="Icon Buttons">
        <div className="flex gap-3">
          <Button variant="ghost" size="icon" aria-label="Crop">
            <Crop />
          </Button>
          <Button variant="ghost" size="icon" active aria-label="Select">
            <MousePointer2 />
          </Button>
          <Button variant="outline" size="icon" aria-label="Close">
            <X />
          </Button>
        </div>
      </Section>
      <Section title="Badges, Switch, Tabs">
        <div className="flex flex-wrap items-center gap-3">
          <Badge>Default</Badge>
          <Badge variant="secondary">Secondary</Badge>
          <Badge variant="success">Success</Badge>
          <Badge variant="outline">Outline</Badge>
          <Switch checked={on} onCheckedChange={setOn} aria-label="On" />
          <Switch checked={false} aria-label="Off" />
          <Segmented
            label="Mode"
            value={tab}
            onValueChange={setTab}
            options={[
              { value: "annotate", label: "Annotate" },
              { value: "presentation", label: "Presentation" },
            ]}
          />
          <span className="flex gap-1">
            <Keycap>⌃</Keycap>
            <Keycap>⇧</Keycap>
            <Keycap>4</Keycap>
          </span>
        </div>
      </Section>
      <Section title="Input & Card">
        <div className="flex flex-wrap items-start gap-6">
          <Field label="Field Label" placeholder="Placeholder text" className="w-64" />
          <Card className="w-80">
            <CardHeader title="Card Title" description="Supporting description text." />
          </Card>
        </div>
      </Section>
      <Section title="Nav Item">
        <div className="flex w-52 flex-col gap-1">
          <NavItem icon={<Image />} active>
            All Screenshots
          </NavItem>
          <NavItem icon={<Pin />}>Pinned</NavItem>
        </div>
      </Section>
    </main>
  );
}
