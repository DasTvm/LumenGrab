import type { RgbaImage } from "@/document/render/pixels";
import { hasCustomCode } from "@/shader/scene";
import { shadersStore } from "@/shader/shader-instance";
import { setCodeGate } from "@/shader/trust";
import type { ShaderLayer } from "@/shader/types";
import { assetNameOf, pruneAssets } from "@/presentation/assets";
import type { DocumentFile } from "@/document/types";
import { serializeDocument } from "@/document/write";
import { platform, type DocumentInfo, type SaveTarget } from "@/platform";
import {
  contentSize,
  countRedactions,
  fileNameFor,
  baseName,
  type ExportFormat,
  type ImageFormat,
  type Size,
} from "../export-model";
import {
  encodeImage,
  flatten,
  renderExport,
  renderPng,
  renderPreviewPng,
  resizeImage,
  webpEncodingAvailable,
} from "../export";
import type { EditorStoreApi } from "../model/store";
import { explain, type Failure } from "./dialogs/FailureDialog";
import type { ExportChoice } from "./dialogs/ExportDialog";
import type { UiStoreApi } from "./ui-store";

export type Dialog =
  | { type: "export"; format: ExportFormat }
  | { type: "unsaved" }
  | { type: "failure"; failure: Failure }
  | null;

export interface Meta {
  /** The name shown in the top bar and offered when saving. */
  fileName: string;
  kind: DocumentInfo["kind"];
}

interface Deps {
  label: string;
  doc: DocumentFile;
  source: RgbaImage;
  info: DocumentInfo;
  app: { name: string; version: string };
  editor: EditorStoreApi;
  ui: UiStoreApi;
  onMeta: (meta: Meta) => void;
  onDialog: (dialog: Dialog) => void;
}

/** How long after the last change the autosave writes the recovery copy. */
export const AUTOSAVE_MS = 3000;

/**
 * Everything that leaves the editor: Save and Save As, Export, Copy, the recovery copy, the unsaved
 * changes guard. It talks to the stores, the renderer and the platform; React only shows the dialogs.
 * A page never names a path: it asks the native side to save "its" file, or to grant a place the user
 * picked in a dialog.
 */
export class DocumentSession {
  private meta: Meta;
  private flat: { project: unknown; image: Promise<RgbaImage> } | null = null;

  /**
   * Custom shader code that came with a file the user opened does not run until they allow it. Code they write
   * here (or add from My shaders or their looks) runs at once; `own` is that code.
   */
  private allowed: boolean;
  private readonly own = new Set<string>();

  constructor(private readonly d: Deps) {
    this.meta = { fileName: d.info.fileName, kind: d.info.kind };
    // Recovered work was never saved: it counts as changed from the first moment.
    if (d.info.kind === "recovered") d.editor.getState().markUnsaved();
    const background = d.editor.getState().project.presentation.background;
    this.allowed = background.type !== "shader" || !hasCustomCode(background);
    d.ui.getState().setCodeAllowed(this.allowed);
  }

  /** Makes this session's gate the one the pages of this window draw with, and asks whether the user allowed this document before. */
  openGate(): () => void {
    setCodeGate((layer) => this.canRun(layer));
    void shadersStore
      .getState()
      .init()
      .then(() => {
        if (shadersStore.getState().trusted.includes(this.d.doc.manifest.documentId))
          this.setAllowed();
      });
    return () => {
      setCodeGate(() => false);
    };
  }

  private setAllowed(): void {
    this.allowed = true;
    this.d.ui.getState().setCodeAllowed(true);
  }

  /** Whether the code of a layer may run now. */
  canRun(layer: ShaderLayer): boolean {
    return this.allowed || (layer.code !== undefined && this.own.has(layer.code));
  }

  /** Whether this document has code that is still switched off. */
  get codeAllowed(): boolean {
    return this.allowed;
  }

  /** "Run custom code": allows the code of this document, now and whenever it is opened again on this computer. */
  async allowCode(): Promise<void> {
    this.setAllowed();
    await shadersStore.getState().trustDocument(this.d.doc.manifest.documentId);
  }

  /** Code the user wrote or chose themselves: it runs. */
  noteOwnCode(code: string): void {
    this.own.add(code);
    // The pages draw again: the gate answers differently now.
    this.d.ui.getState().bumpCode();
  }

  get fileName(): string {
    return this.meta.fileName;
  }

  get kind(): DocumentInfo["kind"] {
    return this.meta.kind;
  }

  private setMeta(next: Partial<Meta>): void {
    this.meta = { ...this.meta, ...next };
    this.d.onMeta(this.meta);
  }

  private get project() {
    return this.d.editor.getState().project;
  }

  private flash(kind: "saved" | "copied"): void {
    this.d.ui.getState().flash(kind);
  }

  private fail(failure: Omit<Failure, "title" | "body"> & { title: string; body: string }): void {
    this.d.onDialog({ type: "failure", failure });
  }

  // ---- the file ------------------------------------------------------------------------------------

  private async bytes(): Promise<Uint8Array> {
    const project = this.project;
    const preview = await renderPreviewPng(this.d.source, project, this.d.doc.assets);
    // Only the pictures the presentation still uses are written (an old background no longer costs space).
    const assets = pruneAssets(this.d.doc.assets, project);
    return serializeDocument({ ...this.d.doc, project, assets }, preview);
  }

  /** The untouched source picture (for measuring its empty edges). */
  get sourceImage(): RgbaImage {
    return this.d.source;
  }

  /** The files of the document (a background picture), by asset name. */
  get assets(): Readonly<Record<string, Uint8Array>> {
    return this.d.doc.assets;
  }

  /**
   * Keeps a picture inside the document (`assets/<sha256>.<ext>`) and returns its asset name. The same
   * bytes give the same name, so choosing a picture twice stores it once.
   */
  async addAsset(bytes: Uint8Array): Promise<{ name: string } | { error: string }> {
    const named = await assetNameOf(bytes);
    if ("name" in named) this.d.doc.assets[named.name] = bytes;
    return named;
  }

  /** Cmd/Ctrl+S: a file saves in place; a new capture asks where (through the Export dialog, which warns about redactions). */
  async save(): Promise<boolean> {
    if (this.meta.kind !== "file") {
      this.d.onDialog({ type: "export", format: "lumengrab" });
      return false;
    }
    return this.saveInPlace();
  }

  async saveInPlace(): Promise<boolean> {
    const { editor } = this.d;
    try {
      await platform.saveDocument(this.d.label, await this.bytes());
    } catch (error) {
      const why = explain(error, "save");
      this.fail({
        title: "Could not save",
        body: "Your work is still open. Nothing was lost.",
        ...why,
        retry: () => void this.saveInPlace(),
        elsewhere: { label: "Save elsewhere…", run: () => void this.saveAsDocument() },
      });
      return false;
    }
    editor.getState().markSaved();
    this.flash("saved");
    await this.dropRecovery();
    return true;
  }

  /** "Save As…" / the first save: asks where, writes a `.lumengrab`, and the window becomes that file. */
  async saveAsDocument(suggested?: string): Promise<boolean> {
    const target = await platform.pickSaveTarget({
      suggestedName: suggested ?? fileNameFor(this.meta.fileName, "lumengrab"),
      formats: ["lumengrab"],
    });
    if (!target) return false;
    return this.writeDocumentTo(target);
  }

  private async writeDocumentTo(target: SaveTarget): Promise<boolean> {
    try {
      await platform.writeGrantedFile(target.token, await this.bytes());
      await platform.bindSavedDocument(this.d.label, target.token);
    } catch (error) {
      const why = explain(error, "save");
      this.fail({
        title: "Could not save",
        body: "Your work is still open. Nothing was lost.",
        ...why,
        retry: () => void this.writeDocumentTo(target),
        elsewhere: { label: "Save elsewhere…", run: () => void this.saveAsDocument() },
      });
      return false;
    }
    this.setMeta({ fileName: target.fileName, kind: "file" });
    this.d.editor.getState().markSaved();
    this.flash("saved");
    await this.dropRecovery();
    return true;
  }

  // ---- export and copy -----------------------------------------------------------------------------

  /** The flattened picture, made once per state of the document (the dialog's estimates reuse it). */
  private flattened(): Promise<RgbaImage> {
    const project = this.project;
    if (this.flat?.project !== project) {
      this.flat = { project, image: flatten(this.d.source, project, this.d.doc.assets) };
    }
    return this.flat.image;
  }

  /** The size of "about 380 KB" in the Export dialog: the picture really encoded at that quality. */
  readonly estimate = async (
    format: "jpg" | "webp",
    size: Size,
    quality: number,
  ): Promise<number> => {
    const image = resizeImage(await this.flattened(), size);
    return (await encodeImage(image, format, quality)).length;
  };

  readonly webpAvailable = (): Promise<boolean> => webpEncodingAvailable();

  get content(): Size {
    return contentSize(this.project, this.d.source);
  }

  get redactions(): number {
    return countRedactions(this.project);
  }

  openExport(format: ExportFormat = "png"): void {
    this.d.onDialog({ type: "export", format });
  }

  /** "Save" in the Export dialog. */
  async export(choice: ExportChoice): Promise<void> {
    if (choice.format === "lumengrab") {
      this.d.onDialog(null);
      await this.saveAsDocument(choice.fileName);
      return;
    }
    const format: ImageFormat = choice.format;
    const target = await platform.pickSaveTarget({
      suggestedName: choice.fileName,
      formats: [format],
    });
    if (!target) return;
    this.d.onDialog(null);
    await this.writeImageTo(target, format, choice);
  }

  private async writeImageTo(
    target: SaveTarget,
    format: ImageFormat,
    choice: ExportChoice,
  ): Promise<void> {
    try {
      const bytes = await renderExport(
        this.d.source,
        this.project,
        { format, size: choice.size, quality: choice.quality },
        this.d.doc.assets,
      );
      await platform.writeGrantedFile(target.token, bytes);
    } catch (error) {
      const why = explain(error, "export");
      this.fail({
        title: "Could not export",
        body: "The image was not written. Your document is unchanged.",
        ...why,
        retry: () => void this.writeImageTo(target, format, choice),
        elsewhere: {
          label: "Choose folder…",
          run: () => void this.export({ ...choice, fileName: target.fileName }),
        },
      });
      return;
    }
    this.flash("saved");
  }

  /** The copy button and the dialog's Copy: the flat picture as a PNG on the clipboard. */
  async copy(size?: Size): Promise<void> {
    try {
      const png =
        size && (size.width !== this.content.width || size.height !== this.content.height)
          ? await encodeImage(resizeImage(await this.flattened(), size), "png")
          : await renderPng(this.d.source, this.project, this.d.doc.assets);
      await platform.copyPngToClipboard(png);
    } catch (error) {
      const why = explain(error, "export");
      this.fail({
        title: "Could not export",
        body: "The image was not copied. Your document is unchanged.",
        ...why,
        retry: () => void this.copy(size),
        elsewhere: {
          label: "Save as file…",
          run: () => {
            this.openExport("png");
          },
        },
      });
      return;
    }
    this.d.onDialog(null);
    this.flash("copied");
  }

  // ---- closing --------------------------------------------------------------------------------------

  /** The user closed the window: with unsaved changes, ask first. */
  requestClose(): void {
    if (this.d.editor.getState().dirty) this.d.onDialog({ type: "unsaved" });
    else void platform.closeDocument(this.d.label);
  }

  async saveAndClose(): Promise<void> {
    this.d.onDialog(null);
    if (this.meta.kind === "file") {
      if (await this.saveInPlace()) await platform.closeDocument(this.d.label);
      return;
    }
    if (await this.saveAsDocument()) await platform.closeDocument(this.d.label);
  }

  async discardAndClose(): Promise<void> {
    this.d.onDialog(null);
    await this.dropRecovery();
    await platform.closeDocument(this.d.label);
  }

  // ---- recovery ---------------------------------------------------------------------------------------

  private get recoveryId(): string {
    return this.d.doc.manifest.documentId;
  }

  private async dropRecovery(): Promise<void> {
    try {
      await platform.recoveryDelete([this.recoveryId]);
    } catch {
      // A copy that cannot be deleted is offered again at the next start; never worth an error.
    }
  }

  /** Writes the recovery copy (autosave). Never over the user's file; failures are silent (the next change tries again). */
  async writeRecovery(): Promise<void> {
    try {
      await platform.recoveryWrite(
        this.recoveryId,
        await this.bytes(),
        baseName(this.meta.fileName),
      );
    } catch {
      // See above.
    }
  }

  /**
   * Starts the watchers: the dirty flag goes to the native side (so closing asks), the autosave runs
   * a few seconds after the last change, and the native close request is answered. Returns the stop function.
   */
  start(): () => void {
    const { editor, label } = this.d;
    let timer: ReturnType<typeof setTimeout> | undefined;
    let lastDirty = editor.getState().dirty;
    void platform.setDocumentDirty(label, lastDirty);
    const unsubscribe = editor.subscribe((state, previous) => {
      if (state.dirty !== lastDirty) {
        lastDirty = state.dirty;
        void platform.setDocumentDirty(label, state.dirty);
      }
      if (state.project !== previous.project || state.dirty !== previous.dirty) {
        clearTimeout(timer);
        if (state.dirty) {
          timer = setTimeout(() => {
            void this.writeRecovery();
          }, AUTOSAVE_MS);
        }
      }
    });
    // Recovered work: the copy is already there; the autosave keeps it fresh once something changes.
    let stopped = false;
    let off: (() => void) | undefined;
    void platform
      .onDocumentCloseRequested(label, () => {
        this.requestClose();
      })
      .then((stop) => {
        if (stopped) stop();
        else off = stop;
      });
    return () => {
      stopped = true;
      clearTimeout(timer);
      unsubscribe();
      off?.();
    };
  }
}
