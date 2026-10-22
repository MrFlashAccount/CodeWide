/** V1 CommandOutput owner, extracted without changing interaction or resource lifetime. */
import type { RenderBlock } from "@codewide/renderers";
import { commandOutputReferences, type ActivityFootprint } from "@codewide/sync-client";
import { useContext, useState } from "react";
import { Pressable, View } from "react-native";
import type { GetTransferAccess, TransferAccess } from "../../../data/private-transfer";
import { useEphemeralAsyncResource } from "../../../rendering/async-resource-store";
import {
  commandActivityInput,
  commandActivityTitle,
  commandOutputFootprint,
} from "../../../rendering/command-activity";
import {
  COMMAND_OUTPUT_PAGE_BYTES,
  commandOutputRevision,
  readCommandOutput,
  type CommandOutputPage,
} from "../../../rendering/command-output-resource";
import { NativeCodeBlock } from "../../../rendering/NativeCodeBlock";
import { usePrivateFileAccessScope } from "../../../rendering/use-private-image-uri";
import { useEvent } from "../../../react/useEvent";
import { formatEstimatedTurnCost } from "../../../turn-cost";
import { compactNumber, formatDuration } from "../../../ui/number-format";
import { TOKEN_SYMBOL } from "../../../ui/token-display";
import { AppText as Text } from "../../../ui/Typography";
import { WaveText } from "../../../ui/WaveText";
import { LargeContentControls } from "../content/FullContentViewer";
import { LargeContentViewerContext } from "../content/contentViewerContext";
import { Card } from "../turns/Card";
import { CopyButton } from "../turns/MessageActionRail";
import {
  ActiveToolCallContext,
  TurnActivityMetricsContext,
  TurnTargetContext,
} from "../turns/turnContexts";
import { styles } from "./CommandOutput.styles";
import { BackgroundTaskOutputButton } from "./BackgroundTaskOutputButton";
import { ProtocolBody, TOOL_RESULT_MAX_HEIGHT } from "./ToolContent";

export function CommandExecutionProtocolBlock({
  block,
  getTransferAccess,
}: {
  block: RenderBlock;
  getTransferAccess?: () => Promise<TransferAccess>;
}) {
  const activeToolCall = useContext(ActiveToolCallContext);
  const command = commandActivityInput(block.raw, block.title);
  const title = commandActivityTitle(command);
  const running = activeToolCall || block.status === "inProgress" || block.status === "running";
  const metrics = useContext(TurnActivityMetricsContext);
  const outputFootprint = commandOutputFootprint(block.raw, metrics);
  const outputAction = useCommandOutputAction(block, command, getTransferAccess ?? null);
  return (
    <Card
      icon="terminal-outline"
      title={title}
      {...(block.status === null ? {} : { status: block.status })}
      collapsible
      headerMeta={<OutputFootprintMetric footprint={outputFootprint} />}
      initiallyExpanded={false}
      onOpen={outputAction.open}
      openEnabled={outputAction.enabled}
      openLabel={`Open output for ${title}`}
    >
      <View style={styles.commandActivitySection}>
        <View style={styles.commandActivitySectionHeader}>
          <Text style={styles.commandActivitySectionLabel}>Input</Text>
          <CopyButton compact text={command} />
        </View>
        <NativeCodeBlock
          fillAvailableWidth
          language="shellscript"
          maxHeight={TOOL_RESULT_MAX_HEIGHT}
          truncate={false}
          value={command}
        />
      </View>
      <LazyCommandOutput
        block={block}
        running={running}
        {...(getTransferAccess === undefined ? {} : { getTransferAccess })}
      />
      <BackgroundTaskOutputButton block={block} />
      {block.durationMs !== null && (
        <Text style={styles.turnMetaText}>{formatDuration(block.durationMs)}</Text>
      )}
      <LargeContentControls
        block={block}
        omitCommandOutput
        {...(getTransferAccess === undefined ? {} : { getTransferAccess })}
      />
    </Card>
  );
}

function ignoreContentRequest(): void {}

function useCommandOutputAction(
  block: RenderBlock,
  command: string,
  getTransferAccess: GetTransferAccess | null,
): { readonly enabled: boolean; readonly open: () => void } {
  const openContent = useContext(LargeContentViewerContext);
  const turnTarget = useContext(TurnTargetContext);
  const dispatchOutput = openContent ?? ignoreContentRequest;
  const itemId = typeof block.raw.id === "string" ? block.raw.id : block.key;
  const open = useEvent(() => {
    if (turnTarget === null) {
      return;
    }
    dispatchOutput({
      command,
      fallbackOutput: block.body ?? "",
      getTransferAccess,
      itemId,
      kind: "command",
      references: commandOutputReferences(block.raw),
      threadId: turnTarget.threadId,
      turnId: turnTarget.turnId,
    });
  });
  return { enabled: openContent !== null && turnTarget !== null, open };
}

interface LazyCommandOutputProps {
  readonly block: RenderBlock;
  readonly getTransferAccess?: GetTransferAccess;
  readonly running: boolean;
}

function LazyCommandOutput(props: LazyCommandOutputProps) {
  const scope = usePrivateFileAccessScope();
  const [byteLimit, setByteLimit] = useState(COMMAND_OUTPUT_PAGE_BYTES);
  const references = commandOutputReferences(props.block.raw);
  const getTransferAccess = props.getTransferAccess;
  const key =
    references.length === 0 || getTransferAccess === undefined
      ? null
      : `command-output:${scope}:${props.block.key}`;
  const revision = commandOutputRevision(references, byteLimit);
  const resource = useEphemeralAsyncResource<CommandOutputPage>(
    key,
    revision,
    async (_publish, signal) => {
      if (getTransferAccess === undefined) {
        throw new Error("Command output connection is unavailable");
      }
      return readCommandOutput({ byteLimit, getTransferAccess, references, scope }, signal);
    },
    (value) => value.text.length * 2,
    true,
  );
  const body = resource.value?.text ?? props.block.body ?? "";
  return (
    <View style={styles.commandActivitySection}>
      <View style={styles.commandActivitySectionHeader}>
        <Text style={styles.commandActivitySectionLabel}>Output</Text>
        {body !== "" && <CopyButton compact text={body} />}
      </View>
      {body !== "" && (
        <ProtocolBody
          body={body}
          code
          codeVariant="terminal"
          collapsible={props.block.collapsible}
          expandedMaxHeight={TOOL_RESULT_MAX_HEIGHT}
          section="output"
          showCopyAction={false}
        />
      )}
      {resource.status === "loading" && (
        <WaveText style={styles.menuNotice} text="Loading output…" />
      )}
      {resource.error !== null && <Text style={styles.errorText}>{resource.error}</Text>}
      {references.length > 0 && getTransferAccess === undefined && (
        <Text style={styles.errorText}>Command output connection is unavailable</Text>
      )}
      {body === "" && resource.status !== "loading" && resource.error === null && (
        <Text style={styles.menuNotice}>{props.running ? "Waiting for output…" : "No output"}</Text>
      )}
      {resource.value?.hasMore === true && (
        <Pressable
          accessibilityRole="button"
          onPress={() => {
            setByteLimit(byteLimit + COMMAND_OUTPUT_PAGE_BYTES);
          }}
        >
          <Text style={styles.menuNotice}>Load more output</Text>
        </Pressable>
      )}
    </View>
  );
}

export function OutputFootprintMetric({ footprint }: { footprint: ActivityFootprint | null }) {
  if (footprint === null || footprint.estimatedTokens === 0) {
    return null;
  }
  const costUsd = footprint.estimatedInputCostUsd;
  const label =
    costUsd === null
      ? `Estimated command output footprint ${footprint.estimatedTokens.toLocaleString()} tokens`
      : `Estimated command output footprint ${footprint.estimatedTokens.toLocaleString()} tokens, ${formatEstimatedTurnCost(costUsd)} API-equivalent input cost`;
  const value = `≈${TOKEN_SYMBOL}${compactNumber(footprint.estimatedTokens)}${costUsd === null ? "" : ` · ≈${formatEstimatedTurnCost(costUsd)}`}`;
  return (
    <View accessibilityLabel={label} accessible style={styles.outputFootprintMetric}>
      <Text numberOfLines={1} style={styles.outputFootprintMetricText}>
        {value}
      </Text>
    </View>
  );
}
