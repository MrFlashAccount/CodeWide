import { isProtocolRecord } from "./protocolValue";
/** V1 protocolCopyText owner, extracted without changing interaction or resource lifetime. */
import type { RenderBlock } from "@codewide/renderers";
import { boundedJsonStringify } from "../../../rendering/bounded-json";
import { normalizeUserMessage } from "../../../rendering/user-message-normalizer";

/** Converts a rendered protocol block into the user-visible text copied from it. */
export function protocolCopyText(block: RenderBlock): string {
  if (
    block.kind === "agentMessage" ||
    block.kind === "plan" ||
    block.kind === "turnPlan" ||
    block.kind === "turnDiff" ||
    block.kind === "reasoning" ||
    block.kind === "commandExecution"
  ) {
    return block.body ?? "";
  }
  if (block.kind === "userMessage") {
    const content = Array.isArray(block.raw.content) ? block.raw.content : [];
    return content
      .map((part) => {
        if (!isProtocolRecord(part)) return "";
        const value = part;
        if (typeof value.text === "string") return normalizeUserMessage(value.text).text;
        if (typeof value.path === "string") return value.path;
        if (typeof value.url === "string") return value.url;
        if (typeof value.name === "string") return value.name;
        return JSON.stringify(value);
      })
      .filter(Boolean)
      .join("\n");
  }
  return boundedJsonStringify(block.raw, 96_000) || block.body || "";
}
