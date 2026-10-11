import type { Point, Rect } from "@/document/schema";
import { distance, HANDLES, type Handle } from "../model/geometry";
import { dragCropHandle, dragNewCrop, moveCropBy } from "./crop-mode";
import type { PointerInfo } from "./select-tool";
import { handlePoint } from "./selection";
import type { UiStoreApi } from "./ui-store";

const HANDLE_REACH = 10;
const DRAG_THRESHOLD = 2;

type Drag =
  | { kind: "handle"; handle: Handle }
  | { kind: "move"; start: Point; from: Rect }
  | { kind: "new"; start: Point; moved: boolean };

/**
 * The pointer in crop mode: a handle resizes the frame, inside it moves the frame, outside it drags a new
 * frame (held to the ratio when there is one). The numbers live in `crop-mode.ts`.
 */
export class CropController {
  private drag: Drag | null = null;

  constructor(private readonly ui: UiStoreApi) {}

  private get zoom(): number {
    return this.ui.getState().view?.zoom ?? 1;
  }

  get active(): boolean {
    return this.drag !== null;
  }

  private handleAt(p: Point): Handle | null {
    const draft = this.ui.getState().crop;
    if (!draft) return null;
    let best: Handle | null = null;
    let bestDistance = HANDLE_REACH / this.zoom;
    for (const handle of HANDLES) {
      const d = distance(handlePoint(draft.rect, 0, handle), p);
      if (d <= bestDistance) {
        best = handle;
        bestDistance = d;
      }
    }
    return best;
  }

  private inside(p: Point): boolean {
    const r = this.ui.getState().crop?.rect;
    return !!r && p.x >= r.x && p.x <= r.x + r.width && p.y >= r.y && p.y <= r.y + r.height;
  }

  down(info: PointerInfo): void {
    const draft = this.ui.getState().crop;
    if (!draft) return;
    const handle = this.handleAt(info.p);
    if (handle) this.drag = { kind: "handle", handle };
    else if (this.inside(info.p)) this.drag = { kind: "move", start: info.p, from: draft.rect };
    else this.drag = { kind: "new", start: info.p, moved: false };
  }

  move(info: PointerInfo): void {
    const drag = this.drag;
    if (!drag) return;
    switch (drag.kind) {
      case "handle":
        dragCropHandle(this.ui, drag.handle, info.p);
        return;
      case "move":
        moveCropBy(this.ui, drag.from, info.p.x - drag.start.x, info.p.y - drag.start.y);
        return;
      case "new":
        if (!drag.moved && distance(info.p, drag.start) * this.zoom < DRAG_THRESHOLD) return;
        drag.moved = true;
        dragNewCrop(this.ui, drag.start, info.p);
    }
  }

  // The pointer position is not needed to end a drag; the signature matches the other controllers.
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  up(_info: PointerInfo): void {
    this.drag = null;
  }

  cancel(): void {
    this.drag = null;
  }

  cursor(p: Point): string {
    const handle = this.handleAt(p);
    if (handle) {
      return {
        n: "ns-resize",
        s: "ns-resize",
        e: "ew-resize",
        w: "ew-resize",
        nw: "nwse-resize",
        se: "nwse-resize",
        ne: "nesw-resize",
        sw: "nesw-resize",
      }[handle];
    }
    return this.inside(p) ? "move" : "crosshair";
  }
}
