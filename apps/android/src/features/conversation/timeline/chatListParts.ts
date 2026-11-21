import { groupChatMarkdownList } from "../../../rendering/markdownListGroups";
import type { VirtualizedTurnPart } from "../turns/virtualizedTurnTypes";

type MarkdownPart = Extract<VirtualizedTurnPart, { kind: "markdownBlock" }>;

/** Preserves the original projection when no completed list benefits from native groups. */
export function groupListParts(parts: MarkdownPart[]): MarkdownPart[] {
  let grouped: MarkdownPart[] | undefined;
  for (const [index, part] of parts.entries()) {
    const groups = groupChatMarkdownList(part.block);
    if (groups !== null) {
      grouped ??= parts.slice(0, index);
      for (const block of groups) {
        grouped.push({ ...part, block });
      }
    } else {
      grouped?.push(part);
    }
  }
  return grouped ?? parts;
}
