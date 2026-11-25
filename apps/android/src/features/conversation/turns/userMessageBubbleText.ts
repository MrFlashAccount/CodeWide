import type { RenderBlock } from "@codewide/renderers";
import { parseDiagnosticRichMarkdown } from "../../../rendering/diagnostic-markdown";
import { projectUserMessageAttachments } from "../../../rendering/user-message-attachments";
import { hasContentReferences } from "../content/blockContentDocument";
import { isProtocolRecord } from "../protocol/protocolValue";

export const USER_MESSAGE_COLLAPSED_LINES = 25;
const USER_MESSAGE_COLLAPSED_CHARS = 1800;

/** Text that fits the ordinary, uncollapsed bubble. */
export function isShortUserMessage(text: string): boolean {
  return (
    text.length <= USER_MESSAGE_COLLAPSED_CHARS &&
    text.split("\n").length <= USER_MESSAGE_COLLAPSED_LINES
  );
}

/** Only verbatim Markdown text with no document or attachment action can own a native text surface. */
export function plainBubbleText(block: RenderBlock): string | null {
  const text = singleLineText(block.raw.content);
  if (text === null || hasContentReferences(block)) {
    return null;
  }
  if (hasProjectedAttachments(block.raw.codewideAttachments)) {
    return null;
  }
  return isVerbatimParagraph(text) ? text : null;
}

function hasProjectedAttachments(projection: unknown): boolean {
  return projection !== undefined && projectUserMessageAttachments([], projection).length !== 0;
}

function isVerbatimParagraph(text: string): boolean {
  const nodes = parseDiagnosticRichMarkdown(text).root.children;
  const paragraph = nodes[0];
  if (nodes.length !== 1 || paragraph?.type !== "paragraph" || paragraph.children.length !== 1) {
    return false;
  }
  const leaf = paragraph.children[0];
  return leaf?.type === "text" && leaf.value === text;
}

function singleLineText(content: unknown): string | null {
  if (!Array.isArray(content) || content.length !== 1) {
    return null;
  }
  const part: unknown = content[0];
  if (!isProtocolRecord(part) || part.type !== "text" || typeof part.text !== "string") {
    return null;
  }
  const text = part.text;
  return text.length <= USER_MESSAGE_COLLAPSED_CHARS && !text.includes("\n") ? text : null;
}
