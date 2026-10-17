import type { ShaderLayer } from "./types";

/**
 * Whether the code of a layer may run. Code that came from a file the user opened does not run until
 * they allow it (docs/adr/0009); the document window sets this gate for its document, the pages that
 * only draw the user's own looks open it. Until a gate is set, nothing runs.
 */
export type CodeGate = (layer: ShaderLayer) => boolean;

let gate: CodeGate = () => false;

export function setCodeGate(next: CodeGate): void {
  gate = next;
}

export const canRunCode: CodeGate = (layer) => gate(layer);

/** Open: every layer may run (the hidden page of the automatic look and the thumbnails of your own looks). */
export const allowAllCode: CodeGate = () => true;
