import { X } from "lucide-react";
import { Button } from "@/ui/components/button";
import { Modal } from "../dialogs/Modal";

/** "Discard changes?" when the Studio is closed with changes (design: Studio / Dialog / Discard changes). */
export function DiscardDialog({
  name,
  onKeep,
  onDiscard,
}: {
  name: string;
  onKeep: () => void;
  onDiscard: () => void;
}) {
  return (
    <Modal label="Discard changes?" onClose={onKeep} className="w-[420px]">
      <div className="flex flex-col gap-1.5">
        <h2 className="text-base font-semibold">Discard changes?</h2>
        <p className="text-[13px] text-muted-foreground">
          {`Your changes to “${name}” will be lost. The look in your editor stays as it was.`}
        </p>
      </div>
      <div className="flex justify-end gap-2">
        <Button data-autofocus variant="outline" onClick={onKeep}>
          Keep editing
        </Button>
        <Button variant="destructive" onClick={onDiscard}>
          Discard
        </Button>
      </div>
    </Modal>
  );
}

/** "This scene is too large" (design: Studio / Dialog / Scene too large). */
export function TooLargeDialog({
  onReview,
  onCancel,
}: {
  onReview: () => void;
  onCancel: () => void;
}) {
  return (
    <Modal label="This scene is too large" onClose={onCancel} className="w-[440px]">
      <div className="flex flex-col gap-1.5">
        <h2 className="text-base font-semibold">This scene is too large</h2>
        <p className="text-[13px] text-muted-foreground">
          This scene has too many layers or effects for the preview to stay smooth. Remove a few and
          try again.
        </p>
      </div>
      <div className="flex justify-end gap-2">
        <Button variant="ghost" onClick={onCancel}>
          <X aria-hidden /> Cancel
        </Button>
        <Button data-autofocus onClick={onReview}>
          Review layers
        </Button>
      </div>
    </Modal>
  );
}
