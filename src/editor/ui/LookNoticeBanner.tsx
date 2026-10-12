import { TriangleAlert, X } from "lucide-react";
import { platform } from "@/platform";
import { Button } from "@/ui/components/button";
import type { Look } from "@/presentation/looks";
import { useStores, useUi } from "./context";
import { applyLookToDocument } from "./presentation/apply-look";
import { looksStore } from "./presentation/looks-instance";
import { usePictureWidth } from "./presentation/use-presentation";

/**
 * "Could not apply your look" (design): the look's background picture is gone. The two ways out: choose
 * another picture for the look, or drop the picture from it. Either way the look is updated for next time.
 */
export function LookNoticeBanner() {
  const { editor, ui, session } = useStores();
  const notice = useUi((s) => s.lookNotice);
  const width = usePictureWidth();
  if (!notice) return null;

  const withBackground = async (change: (look: Look) => Look): Promise<void> => {
    const { looks, defaultLook } = looksStore.getState();
    const own = looks.find((l) => l.id === notice.lookId);
    const base = own ?? (defaultLook?.id === notice.lookId ? defaultLook : null);
    if (!base) return;
    const next = change(base);
    if (own) await looksStore.getState().updateLook(own.id, next.parts);
    if (defaultLook?.id === next.id) await looksStore.getState().setDefault(next);
    await applyLookToDocument(next, { editor, ui, session, width });
  };

  const choose = async () => {
    const bytes = await platform.pickImage().catch(() => null);
    if (!bytes) return;
    const named = await session.addAsset(bytes);
    if ("error" in named) {
      ui.getState().setLookNotice({ ...notice, message: named.error });
      return;
    }
    await looksStore.getState().addAsset(named.name, bytes);
    await withBackground((look) => {
      const bg = look.parts.background;
      return bg?.type === "image"
        ? { ...look, parts: { ...look.parts, background: { ...bg, asset: named.name } } }
        : look;
    });
  };
  const remove = () =>
    withBackground((look) => {
      const parts = { ...look.parts };
      delete parts.background;
      return { ...look, parts };
    });

  return (
    <div
      role="alert"
      className="flex items-start gap-3 border-b border-warning-border bg-warning-soft px-6 py-2.5 text-[13px]"
    >
      <TriangleAlert aria-hidden className="mt-0.5 size-4 shrink-0 text-warning" />
      <div className="flex min-w-0 flex-1 flex-col gap-2">
        <div className="flex flex-col gap-0.5">
          <span className="font-semibold">Could not apply your look</span>
          <span>{notice.message}</span>
        </div>
        <div className="flex gap-2">
          <Button variant="outline" className="h-8 px-3 text-[13px]" onClick={() => void choose()}>
            Choose image…
          </Button>
          <Button variant="outline" className="h-8 px-3 text-[13px]" onClick={() => void remove()}>
            Remove image from look
          </Button>
        </div>
      </div>
      <button
        type="button"
        aria-label="Dismiss"
        className="rounded-sm p-1 text-muted-foreground hover:bg-black/5"
        onClick={() => {
          ui.getState().setLookNotice(null);
        }}
      >
        <X aria-hidden className="size-4" />
      </button>
    </div>
  );
}
