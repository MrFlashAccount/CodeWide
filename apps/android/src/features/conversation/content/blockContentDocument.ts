import type { RenderBlock, RenderContentReference } from "@codewide/renderers";
import type { GetTransferAccess } from "../../../data/private-transfer";
import type {
  ContentDocumentPart,
  ContentPresentation,
  DocumentContentRouteRequest,
} from "../../../services/content/contentRouteSession";

/** The text a block shows itself, which the document puts before its out-of-line fields. */
type InlineContent = {
  readonly presentation: ContentPresentation;
  readonly text: string;
};

/**
 * The document one block opens in the full-screen viewer: its inline text,
 * then every field the Companion keeps out of line, so nothing the block
 * holds is unreachable. Null when there is nothing to show.
 */
export function blockContentDocument({
  block,
  getTransferAccess,
  inline,
  title,
}: {
  readonly block: RenderBlock;
  readonly getTransferAccess: GetTransferAccess | null;
  readonly inline: InlineContent | null;
  readonly title: string;
}): DocumentContentRouteRequest | null {
  const parts: ContentDocumentPart[] = [];
  if (inline !== null && inline.text !== "") {
    parts.push({
      kind: "inline",
      label: "Item",
      presentation: inline.presentation,
      text: inline.text,
    });
  }
  for (const [pointer, reference] of blockContentReferences(block)) {
    parts.push({
      kind: "reference",
      label: contentPointerLabel(pointer),
      presentation: contentReferencePresentation(pointer, reference),
      reference,
    });
  }
  const [first, ...rest] = parts;
  return first === undefined
    ? null
    : { getTransferAccess, kind: "document", parts: [first, ...rest], title };
}

/** A user message the Companion shortened opens its whole text; a complete one opens nothing. */
export function userMessageDocument(
  block: RenderBlock,
  getTransferAccess: GetTransferAccess | null,
): DocumentContentRouteRequest | null {
  return blockContentDocument({ block, getTransferAccess, inline: null, title: "Message" });
}

/** Whether the Companion keeps any of the block's content out of line. */
export function hasContentReferences(block: RenderBlock): boolean {
  return blockContentReferences(block).length > 0;
}

/** The block's out-of-line fields by JSON pointer, then its whole item when externalized. */
function blockContentReferences(
  block: RenderBlock,
): readonly (readonly [string, RenderContentReference])[] {
  if (block.content === null) {
    return [];
  }
  const entries = Object.entries(block.content.fields);
  return block.content.whole === null ? entries : [...entries, ["/", block.content.whole]];
}

/** How a referenced field reads: Markdown, terminal output or plain text. */
function contentReferencePresentation(
  pointer: string,
  reference: RenderContentReference,
): ContentPresentation {
  if (reference.contentType.startsWith("text/markdown")) {
    return "markdown";
  }
  if (
    reference.contentType.startsWith("text/x-ansi") ||
    pointer === "/aggregatedOutput" ||
    pointer.endsWith("/aggregatedOutput")
  ) {
    return "terminal";
  }
  return "text";
}

/** A field's readable path: `result › content › 0 › text`; the root is the whole item. */
function contentPointerLabel(pointer: string): string {
  const segments = pointer
    .split("/")
    .filter(Boolean)
    .map((segment) => segment.replaceAll("~1", "/").replaceAll("~0", "~"));
  return segments.length === 0 ? "Whole item" : segments.join(" › ");
}
