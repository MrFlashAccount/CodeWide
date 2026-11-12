import type { RenderBlock } from "@codewide/renderers";
import {
  parseActivityFootprint,
  type ActivityFootprint,
  type ActivityMetrics,
} from "@codewide/sync-client";
import type { ComposeIconName } from "../../../presentation/icons/composeIconNames";
import { commandOutputFootprint } from "../../../rendering/command-activity";
import { compactNumber } from "../../../ui/number-format";
import { TOKEN_SYMBOL } from "../../../ui/token-display";
import { orchestrationToolCall } from "./orchestrationToolCall";
import { protocolIcon } from "./protocolKind";

const CUSTOM_ACTIVITY_ROWS: ReadonlySet<string> = new Set([
  "agentMessage",
  "collabAgentToolCall",
  "reasoning",
  "subAgentActivity",
  "tokenUsage",
  "unknown",
  "userMessage",
]);

/** Whether Activity can obtain its native list-row action through the shared Card owner. */
export function protocolBlockUsesCard(block: RenderBlock): boolean {
  return (
    !CUSTOM_ACTIVITY_ROWS.has(block.kind) &&
    (block.kind !== "dynamicToolCall" || orchestrationToolCall(block.raw, block.status) === null)
  );
}

type ProtocolActivityRow = {
  readonly description: string;
  readonly failed: boolean;
  readonly icon: ComposeIconName;
};

/** Projects one Activity list row without estimating usage on the client. */
export function protocolActivityRow(
  block: RenderBlock,
  metrics: ActivityMetrics | null,
): ProtocolActivityRow {
  const footprint = activityOutputFootprint(block, metrics);
  const name = activityToolCallName(block);
  return {
    description:
      footprint === null || footprint.estimatedTokens === 0
        ? name
        : `≈${TOKEN_SYMBOL}${compactNumber(footprint.estimatedTokens)} · ${name}`,
    failed: block.status === "failed" || block.status === "error",
    icon: protocolIcon(block.kind),
  };
}

function activityOutputFootprint(
  block: RenderBlock,
  metrics: ActivityMetrics | null,
): ActivityFootprint | null {
  if (block.kind === "commandExecution") {
    return commandOutputFootprint(block.raw, metrics);
  }
  return parseActivityFootprint(block.raw.codewideOutputFootprint);
}

/** Keeps the provider's concrete tool name when the neutral item carries it. */
function activityToolCallName(block: RenderBlock): string {
  const tool = block.raw.tool;
  if (typeof tool === "string" && tool.trim() !== "") {
    return tool;
  }
  return block.kind;
}
