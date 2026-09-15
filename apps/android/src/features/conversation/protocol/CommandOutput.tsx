/** V1 CommandOutput owner, extracted without changing interaction or resource lifetime. */
import { type RenderBlock } from "@codewide/renderers";
import { commandOutputReferences, type OutputFootprintProjection } from "@codewide/sync-client";
import { useContext, useState } from "react";
import { Pressable, View } from "react-native";
import { type GetTransferAccess } from "../../../data/private-transfer";
import { useEphemeralAsyncResource } from "../../../rendering/async-resource-store";
import {
  commandActivityInput,
  commandActivityTitle,
  commandOutputFootprint,
  estimatedOutputInputCostUsd,
} from "../../../rendering/command-activity";
import {
  COMMAND_OUTPUT_PAGE_BYTES,
  commandOutputRevision,
  readCommandOutput,
  type CommandOutputPage,
} from "../../../rendering/command-output-resource";
import { NativeCodeBlock } from "../../../rendering/NativeCodeBlock";
import { usePrivateFileAccessScope } from "../../../rendering/use-private-image-uri";
import { formatEstimatedTurnCost } from "../../../turn-cost";
import { compactNumber, formatDuration } from "../../../ui/number-format";
import { TOKEN_SYMBOL } from "../../../ui/token-display";
import { AppText as Text } from "../../../ui/Typography";
import { WaveText } from "../../../ui/WaveText";
import { LargeContentControls } from "../content/FullContentViewer";
import { Card } from "../turns/Card";
import { CopyButton } from "../turns/MessageActionRail";
import { ActiveToolCallContext, TurnUsageContext } from "../turns/turnContexts";
import { styles } from "./CommandOutput.styles";
import { ProtocolBody, TOOL_RESULT_MAX_HEIGHT } from "./ToolContent";

export function CommandExecutionProtocolBlock({
  block,
  getTransferAccess,
}: {
  block: RenderBlock;
  getTransferAccess?(): Promise<{ baseUrl: string; authorization: string }>;
}) {
  const activeToolCall = useContext(ActiveToolCallContext);
  const command = commandActivityInput(block.raw, block.title);
  const running = activeToolCall || block.status === "inProgress" || block.status === "running";
  const outputFootprint = commandOutputFootprint(block.raw, block.body ?? "");
  return (
    <Card
      title={commandActivityTitle(command)}
      icon="terminal-outline"
      {...(block.status === null ? {} : { status: block.status })}
      headerMeta={<OutputFootprintMetric footprint={outputFootprint} />}
      collapsible
      initiallyExpanded={false}
    >
      <View style={styles.commandActivitySection}>
        <View style={styles.commandActivitySectionHeader}>
          <Text style={styles.commandActivitySectionLabel}>Input</Text>
          <CopyButton text={command} compact />
        </View>
        <NativeCodeBlock
          value={command}
          language="shellscript"
          maxHeight={TOOL_RESULT_MAX_HEIGHT}
          fillAvailableWidth
          truncate={false}
        />
      </View>
      <LazyCommandOutput
        block={block}
        running={running}
        {...(getTransferAccess === undefined ? {} : { getTransferAccess })}
      />
      {block.durationMs !== null && (
        <Text style={styles.turnMetaText}>{formatDuration(block.durationMs)}</Text>
      )}
      <LargeContentControls
        block={block}
        {...(getTransferAccess === undefined ? {} : { getTransferAccess })}
      />
    </Card>
  );
}

export interface LazyCommandOutputProps {
  readonly block: RenderBlock;
  readonly running: boolean;
  readonly getTransferAccess?: GetTransferAccess;
}

export function LazyCommandOutput(props: LazyCommandOutputProps) {
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
      if (getTransferAccess === undefined)
        throw new Error("Command output connection is unavailable");
      return await readCommandOutput({ scope, references, byteLimit, getTransferAccess }, signal);
    },
    (value) => value.text.length * 2,
    true,
  );
  const body = resource.value?.text ?? props.block.body ?? "";
  return (
    <View style={styles.commandActivitySection}>
      <View style={styles.commandActivitySectionHeader}>
        <Text style={styles.commandActivitySectionLabel}>Output</Text>
        {body !== "" && <CopyButton text={body} compact />}
      </View>
      {body !== "" && (
        <ProtocolBody
          body={body}
          code
          collapsible={props.block.collapsible}
          expandedMaxHeight={TOOL_RESULT_MAX_HEIGHT}
          section="output"
          codeVariant="terminal"
          showCopyAction={false}
        />
      )}
      {resource.status === "loading" && (
        <WaveText text="Loading output…" style={styles.menuNotice} />
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
          onPress={() => setByteLimit(byteLimit + COMMAND_OUTPUT_PAGE_BYTES)}
        >
          <Text style={styles.menuNotice}>Load more output</Text>
        </Pressable>
      )}
    </View>
  );
}

export function OutputFootprintMetric({
  footprint,
}: {
  footprint: OutputFootprintProjection | null;
}) {
  const usage = useContext(TurnUsageContext);
  if (footprint === null || footprint.estimatedTokens === 0) return null;
  const costUsd = estimatedOutputInputCostUsd(footprint, usage);
  const label =
    costUsd === null
      ? `Estimated command output footprint ${footprint.estimatedTokens.toLocaleString()} tokens`
      : `Estimated command output footprint ${footprint.estimatedTokens.toLocaleString()} tokens, ${formatEstimatedTurnCost(costUsd)} API-equivalent input cost`;
  const value = `≈${TOKEN_SYMBOL}${compactNumber(footprint.estimatedTokens)}${costUsd === null ? "" : ` · ≈${formatEstimatedTurnCost(costUsd)}`}`;
  return (
    <View accessible accessibilityLabel={label} style={styles.outputFootprintMetric}>
      <Text numberOfLines={1} style={styles.outputFootprintMetricText}>
        {value}
      </Text>
    </View>
  );
}
