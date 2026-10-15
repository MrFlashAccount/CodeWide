import type { RenderBlock } from "@codewide/renderers";

/**
 * How a group of actions draws: thinking as a status, subagent rows as
 * navigation, anything else as a disclosure of tool calls.
 */
export function activitySegmentKind(
  blocks: readonly RenderBlock[],
): "agentNavigation" | "disclosure" | "thinking" {
  if (blocks.length > 0 && blocks.every((block) => block.kind === "reasoning")) {
    return "thinking";
  }
  if (
    blocks.length > 0 &&
    blocks.every(
      (block) => block.kind === "collabAgentToolCall" || block.kind === "subAgentActivity",
    )
  ) {
    return "agentNavigation";
  }
  return "disclosure";
}
