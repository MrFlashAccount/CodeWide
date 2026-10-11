/**
 * The model a Claude session last answered with, from its stored messages:
 * the `message.model` of the newest main-loop assistant message. Sub-agent
 * messages (`parent_tool_use_id` set) and synthetic placeholders such as
 * `<synthetic>` are skipped. Pure.
 */

function fieldOf(value: unknown, key: string): unknown {
  return typeof value === "object" && value !== null ? Reflect.get(value, key) : undefined;
}

const isMainLoopAnswer = (raw: unknown): boolean =>
  fieldOf(raw, "type") === "assistant" && typeof fieldOf(raw, "parent_tool_use_id") !== "string";

function recordedModelOf(raw: unknown): string | null {
  if (!isMainLoopAnswer(raw)) {
    return null;
  }
  const model = fieldOf(fieldOf(raw, "message"), "model");
  return typeof model === "string" && model.length > 0 && !model.startsWith("<") ? model : null;
}

export function lastRecordedModel(messages: readonly unknown[]): string | null {
  for (let index = messages.length - 1; index >= 0; index -= 1) {
    const model = recordedModelOf(messages[index]);
    if (model !== null) {
      return model;
    }
  }
  return null;
}
