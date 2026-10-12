import { Info } from "lucide-react";
import { Button } from "@/ui/components/button";
import { useStores } from "../context";
import { AspectSection } from "./AspectSection";
import { BackgroundSection } from "./BackgroundSection";
import { FrameSection } from "./FrameSection";
import { PaddingSection, RadiusSection, ShadowSection } from "./LayoutSections";
import { LooksSection } from "./LooksSection";
import { usePresentation } from "./use-presentation";

const Divider = () => <hr className="border-border" />;

/**
 * The right panel of Presentation mode (design: Presentation panel): looks, background, padding, corner
 * radius, shadow, window frame and aspect ratio. Every change is one undo step; the canvas shows the
 * result at once.
 */
export function PresentationPanel() {
  const { editor } = useStores();
  const { p } = usePresentation();
  return (
    <div className="flex min-h-0 flex-1 flex-col" data-testid="presentation-panel">
      {p.enabled ? (
        // The side padding is room for the focus rings: a scroll container clips whatever sticks out of it.
        <div className="-mx-2 flex min-h-0 flex-1 flex-col gap-5 overflow-y-auto px-2 pb-2">
          <LooksSection />
          <Divider />
          <BackgroundSection />
          <Divider />
          <PaddingSection />
          <Divider />
          <RadiusSection />
          <Divider />
          <ShadowSection />
          <Divider />
          <FrameSection />
          <Divider />
          <AspectSection />
          <Divider />
          <Button
            variant="ghost"
            className="h-9 justify-start px-2 text-[13px] text-muted-foreground"
            onClick={() => {
              editor.getState().change((project) => {
                project.presentation.enabled = false;
              });
            }}
          >
            Remove the presentation
          </Button>
        </div>
      ) : (
        <div className="-mx-2 flex min-h-0 flex-1 flex-col gap-4 overflow-y-auto px-2">
          <p className="flex gap-2 text-[13px] text-muted-foreground" role="status">
            <Info aria-hidden className="mt-0.5 size-4 shrink-0" />
            The presentation is off, so the picture is exported as it is. Pick a look to turn it on.
          </p>
          <LooksSection />
        </div>
      )}
    </div>
  );
}
