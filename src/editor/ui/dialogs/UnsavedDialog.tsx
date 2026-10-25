import { Button } from "@/ui/components/button";
import { Modal } from "@/ui/components/modal";

/** "Save changes to “name”?" (design: Unsaved changes). */
export function UnsavedDialog({
  name,
  onSave,
  onDiscard,
  onCancel,
}: {
  name: string;
  onSave: () => void;
  onDiscard: () => void;
  onCancel: () => void;
}) {
  return (
    <Modal label="Unsaved changes" onClose={onCancel} className="w-[460px]">
      <div className="flex flex-col gap-1.5">
        <h2 className="text-base font-semibold">{`Save changes to “${name}”?`}</h2>
        <p className="text-[13px] text-muted-foreground">
          Your changes will be lost if you don't save them.
        </p>
      </div>
      <div className="flex justify-end gap-2">
        <Button variant="ghost" className="mr-auto text-destructive" onClick={onDiscard}>
          Don't save
        </Button>
        <Button variant="outline" onClick={onCancel}>
          Cancel
        </Button>
        <Button data-autofocus onClick={onSave}>
          Save
        </Button>
      </div>
    </Modal>
  );
}
