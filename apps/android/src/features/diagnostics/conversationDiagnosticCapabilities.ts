import type { RenderBlock } from "@codewide/renderers";
/** Qualified capabilities consumed by the diagnostics owner in conversation composition. */
export type ConversationDiagnosticCapabilities = {
  onFixUnsupportedBlock: ((block: RenderBlock) => Promise<void>) | undefined;
};
