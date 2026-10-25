import { Copy, ExternalLink } from "lucide-react";
import { Button } from "@/ui/components/button";
import { Modal } from "@/ui/components/modal";
import { linkParts } from "./text-read";

/** "Open this link?" (design: "M6 / Editor text / Dialog open link"): the whole address, the host in bold, before anything opens. */
export function OpenLinkDialog({
  link,
  onOpen,
  onCopy,
  onCancel,
}: {
  link: string;
  onOpen: () => void;
  onCopy: () => void;
  onCancel: () => void;
}) {
  const { scheme, host, rest } = linkParts(link);
  return (
    <Modal label="Open this link?" className="w-[480px]" onClose={onCancel}>
      <h2 className="text-lg font-semibold">Open this link?</h2>
      <p className="text-sm text-muted-foreground">
        LumenGrab read this address from your picture. Check it before you open it in your browser.
      </p>
      <div className="flex flex-col gap-1.5 rounded-md border border-border bg-muted/50 p-3">
        <span className="text-[11px] font-semibold tracking-wide text-muted-foreground uppercase">
          Full address
        </span>
        <p className="font-mono text-[13px] break-all" data-testid="link-address">
          <span className="text-muted-foreground">{scheme}</span>
          <strong className="font-semibold">{host}</strong>
          <span className="text-muted-foreground">{rest}</span>
        </p>
      </div>
      <p className="text-xs text-muted-foreground">
        Addresses in pictures can be misleading. Only open links you trust.
      </p>
      <div className="flex justify-end gap-2">
        <Button variant="ghost" onClick={onCancel}>
          Cancel
        </Button>
        <Button variant="outline" onClick={onCopy}>
          <Copy aria-hidden /> Copy
        </Button>
        <Button variant="accent" data-autofocus onClick={onOpen}>
          <ExternalLink aria-hidden /> Open
        </Button>
      </div>
    </Modal>
  );
}
