import type { RenderBlock } from "@codewide/renderers";
import type { MarkdownDocumentBlock } from "../../../rendering/markdown-document-blocks";
import type { ActiveTurnSequencePart } from "../../../rendering/turn-sequence";

export type VirtualizedTurnPart =
  | {
      readonly block: MarkdownDocumentBlock;
      readonly kind: "markdownBlock";
      readonly response: RenderBlock;
      readonly streaming: boolean;
    }
  | {
      readonly kind: "externalMarkdown";
      readonly response: RenderBlock;
    }
  | {
      readonly kind: "activity";
      readonly part: Exclude<ActiveTurnSequencePart, { kind: "agent" }>;
    }
  | { readonly kind: "empty" };

export type VirtualizedTurnPlacement = "end" | "middle" | "single" | "start";
