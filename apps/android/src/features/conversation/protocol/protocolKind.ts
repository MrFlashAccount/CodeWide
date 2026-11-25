/** V1 protocolKind owner, extracted without changing interaction or resource lifetime. */
import type { ComposeIconName } from "../../../presentation/icons/composeIconNames";

export function protocolIcon(kind: string): ComposeIconName {
  if (kind === "reasoning") {
    return "bulb-outline";
  }
  if (kind === "commandExecution") {
    return "terminal-outline";
  }
  if (kind === "fileChange") {
    return "document-text-outline";
  }
  if (kind === "webSearch") {
    return "search";
  }
  if (kind === "mcpToolCall" || kind === "dynamicToolCall") {
    return "extension-puzzle-outline";
  }
  if (kind === "subAgentActivity" || kind === "collabAgentToolCall") {
    return "people-outline";
  }
  if (kind === "imageGeneration" || kind === "imageView") {
    return "image-outline";
  }
  if (kind === "tokenUsage") {
    return "speedometer-outline";
  }
  return "cube-outline";
}

export function isToolActivityKind(kind: string): boolean {
  return (
    kind === "commandExecution" ||
    kind === "fileChange" ||
    kind === "mcpToolCall" ||
    kind === "dynamicToolCall" ||
    kind === "webSearch" ||
    kind === "collabAgentToolCall" ||
    kind === "subAgentActivity"
  );
}
