import { renderProtocolFallback } from "./ProtocolFallback";
/** V1 ProtocolBlock owner, extracted without changing interaction or resource lifetime. */
import type { RenderBlock } from "@codewide/renderers";
import { useContext } from "react";
import { View } from "react-native";
import type { ContentReviewTarget } from "../../../rendering/content-review";
import { reasoningActivityTitle } from "../../../rendering/reasoning-title";
import { SearchMessage } from "../../../rendering/SearchMessageFocus";
import { colors } from "../../../theme";
import { InlineIcon } from "../../../ui/InlineIcon";
import { AppText as Text } from "../../../ui/Typography";
import { WaveText } from "../../../ui/WaveText";
import { CompleteAgentMarkdown } from "../content/AgentResponseMarkdown";
import { LargeContentControls } from "../content/FullContentViewer";
import { ActiveToolCallContext, TurnActivityContentContext } from "../turns/turnContexts";
import { UserMessageContent } from "../turns/UserMessageContent";
import { AgentActivityProtocolBlock } from "./AgentActivityProtocolBlock";
import { CommandExecutionProtocolBlock } from "./CommandOutput";
import { FileChangeProtocolBlock } from "./FileChangeProtocolBlock";
import { ImageProtocolBlock } from "./ImageProtocolBlock";
import { MemoryCitationList } from "./MemoryCitationList";
import { styles } from "./ProtocolBlock.styles";
import { TokenUsageProtocolBlock } from "./TokenUsageProtocolBlock";
import { ToolCallProtocolBlock } from "./ToolContent";
import { UnknownProtocolBlock } from "./UnknownProtocolBlock";
import { WebSearchProtocolBlock } from "./WebSearchProtocolBlock";

export function ProtocolBlock({
  block,
  getTransferAccess,
  onFixUnsupportedBlock,
}: {
  block: RenderBlock;
  getTransferAccess?: () => Promise<{ authorization: string; baseUrl: string }>;
  onFixUnsupportedBlock?: (block: RenderBlock) => Promise<void>;
}) {
  const activeToolCall = useContext(ActiveToolCallContext);
  const insideTurnActivity = useContext(TurnActivityContentContext);
  if (block.kind === "userMessage") {
    const content = Array.isArray(block.raw.content) ? block.raw.content : [];
    return (
      <View style={styles.userBubble} testID="user-bubble">
        <UserMessageContent
          content={content}
          projectedAttachments={block.raw.codewideAttachments}
          {...(getTransferAccess === undefined ? {} : { getTransferAccess })}
        />
        <LargeContentControls
          block={block}
          {...(getTransferAccess === undefined ? {} : { getTransferAccess })}
        />
      </View>
    );
  }
  if (block.kind === "agentMessage") {
    const reviewTarget: ContentReviewTarget = {
      id: `agent-response:${block.key}`,
      label: "Completed agent response",
      reference: block.key,
    };
    return (
      <View style={styles.agentMessage}>
        <SearchMessage itemId={block.raw.id}>
          <CompleteAgentMarkdown
            reviewTarget={reviewTarget}
            source={block.body ?? ""}
            streamKey={block.key}
          />
        </SearchMessage>
        <MemoryCitationList value={block.raw.memoryCitation} />
        <LargeContentControls
          block={block}
          {...(getTransferAccess === undefined ? {} : { getTransferAccess })}
        />
      </View>
    );
  }
  if (block.kind === "tokenUsage") {
    return <TokenUsageProtocolBlock block={block} />;
  }
  if (block.kind === "commandExecution") {
    return (
      <CommandExecutionProtocolBlock
        block={block}
        {...(getTransferAccess === undefined ? {} : { getTransferAccess })}
      />
    );
  }
  if (block.kind === "fileChange") {
    return (
      <>
        <FileChangeProtocolBlock block={block} />
        <LargeContentControls
          block={block}
          {...(getTransferAccess === undefined ? {} : { getTransferAccess })}
        />
      </>
    );
  }
  if (block.kind === "mcpToolCall" || block.kind === "dynamicToolCall") {
    return (
      <>
        <ToolCallProtocolBlock
          block={block}
          {...(getTransferAccess === undefined ? {} : { getTransferAccess })}
        />
        <LargeContentControls
          block={block}
          {...(getTransferAccess === undefined ? {} : { getTransferAccess })}
        />
      </>
    );
  }
  if (block.kind === "webSearch") {
    return (
      <>
        <WebSearchProtocolBlock block={block} />
        <LargeContentControls
          block={block}
          {...(getTransferAccess === undefined ? {} : { getTransferAccess })}
        />
      </>
    );
  }
  if (block.kind === "collabAgentToolCall" || block.kind === "subAgentActivity") {
    return (
      <>
        <AgentActivityProtocolBlock block={block} />
        <LargeContentControls
          block={block}
          {...(getTransferAccess === undefined ? {} : { getTransferAccess })}
        />
      </>
    );
  }
  if (block.kind === "imageView" || block.kind === "imageGeneration") {
    return (
      <>
        <ImageProtocolBlock
          block={block}
          {...(getTransferAccess === undefined ? {} : { getTransferAccess })}
        />
        <LargeContentControls
          block={block}
          {...(getTransferAccess === undefined ? {} : { getTransferAccess })}
        />
      </>
    );
  }
  if (block.kind === "unknown") {
    return (
      <>
        <UnknownProtocolBlock
          block={block}
          {...(onFixUnsupportedBlock === undefined ? {} : { onFixUnsupportedBlock })}
        />
        <LargeContentControls
          block={block}
          {...(getTransferAccess === undefined ? {} : { getTransferAccess })}
        />
      </>
    );
  }
  const displayTitle =
    block.kind === "reasoning"
      ? reasoningActivityTitle(block.body, activeToolCall ? "inProgress" : block.status)
      : block.title;
  if (block.kind === "reasoning") {
    const running = activeToolCall || block.status === "inProgress" || block.status === "running";
    return (
      <View
        style={[styles.thinkingStatus, insideTurnActivity && styles.thinkingStatusInActivity]}
        testID="thinking-status"
      >
        <View style={styles.cardIconSlot}>
          <InlineIcon color={colors.textMuted} name="bulb-outline" role="label" />
        </View>
        {running ? (
          <WaveText
            containerStyle={styles.cardTitleWave}
            style={styles.cardTitle}
            text={displayTitle}
          />
        ) : (
          <Text numberOfLines={1} style={styles.cardTitle}>
            {displayTitle}
          </Text>
        )}
      </View>
    );
  }
  return renderProtocolFallback(block, displayTitle, getTransferAccess);
}
