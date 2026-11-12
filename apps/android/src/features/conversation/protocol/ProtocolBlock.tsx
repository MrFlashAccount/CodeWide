import { renderProtocolFallback } from "./ProtocolFallback";
/** V1 ProtocolBlock owner, extracted without changing interaction or resource lifetime. */
import type { RenderBlock } from "@codewide/renderers";
import { useContext } from "react";
import { View } from "react-native";
import type { ContentReviewTarget } from "../../../rendering/content-review";
import { CompleteMarkdown } from "../../../rendering/CompleteMarkdown";
import { reasoningActivityTitle } from "../../../rendering/reasoning-title";
import { SearchMessage } from "../../../rendering/SearchMessageFocus";
import { AgentResponseMarkdown } from "../content/AgentResponseMarkdown";
import { hasContentReferences, userMessageDocument } from "../content/blockContentDocument";
import { ContentDocumentPress } from "../content/ContentDocumentPress";
import { ActiveToolCallContext } from "../turns/turnContexts";
import { UserMessageContent } from "../turns/UserMessageContent";
import { AgentActivityProtocolBlock } from "./AgentActivityProtocolBlock";
import { CommandExecutionProtocolBlock } from "./CommandOutput";
import { ContentDocumentCard } from "./ContentDocumentCard";
import { FileChangeProtocolBlock } from "./FileChangeProtocolBlock";
import { ImageProtocolBlock } from "./ImageProtocolBlock";
import { MemoryCitationList } from "./MemoryCitationList";
import { orchestrationToolCall } from "./orchestrationToolCall";
import { OrchestrationProtocolBlock } from "./OrchestrationProtocolBlock";
import { styles } from "./ProtocolBlock.styles";
import { protocolCopyText } from "./protocolCopyText";
import { ThinkingStatus } from "./ThinkingStatus";
import { TokenUsageProtocolBlock } from "./TokenUsageProtocolBlock";
import { ToolCallProtocolBlock } from "./ToolContent";
import { UnknownProtocolBlock } from "./UnknownProtocolBlock";
import { WebSearchProtocolBlock } from "./WebSearchProtocolBlock";
import type { TransferAccess } from "../../../data/private-transfer";
import { surfaceToneMessageStyle, useSurfaceTone } from "../../../ui/surfaceTone";

export function ProtocolBlock({
  block,
  getTransferAccess,
  onFixUnsupportedBlock,
}: {
  block: RenderBlock;
  getTransferAccess?: () => Promise<TransferAccess>;
  onFixUnsupportedBlock?: (block: RenderBlock) => Promise<void>;
}) {
  const activeToolCall = useContext(ActiveToolCallContext);
  const tone = useSurfaceTone();
  if (block.kind === "userMessage") {
    const content = Array.isArray(block.raw.content) ? block.raw.content : [];
    return (
      <View style={[styles.userBubble, surfaceToneMessageStyle(tone)]} testID="user-bubble">
        <ContentDocumentPress
          accessibilityLabel="Open full message"
          document={userMessageDocument(block, getTransferAccess ?? null)}
        >
          <UserMessageContent
            content={content}
            projectedAttachments={block.raw.codewideAttachments}
            {...(getTransferAccess === undefined ? {} : { getTransferAccess })}
          />
        </ContentDocumentPress>
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
        {block.content?.fields["/text"] === undefined ? (
          <SearchMessage itemId={block.raw.id}>
            <CompleteMarkdown
              reviewTarget={reviewTarget}
              source={block.body ?? ""}
              streamKey={block.key}
            />
          </SearchMessage>
        ) : (
          // The Companion keeps a long response out of line; this reads all of it in place.
          <AgentResponseMarkdown
            block={block}
            {...(getTransferAccess === undefined ? {} : { getTransferAccess })}
          />
        )}
        <MemoryCitationList value={block.raw.memoryCitation} />
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
  if (
    hasContentReferences(block) &&
    (block.kind === "fileChange" ||
      block.kind === "webSearch" ||
      block.kind === "imageView" ||
      block.kind === "imageGeneration")
  ) {
    // These viewers read only what the item holds inline; its out-of-line
    // fields would be unreachable there, so the whole item opens instead.
    return (
      <ContentDocumentCard
        block={block}
        getTransferAccess={getTransferAccess ?? null}
        inline={{ presentation: "text", text: protocolCopyText(block) }}
        title={block.title}
      />
    );
  }
  if (block.kind === "fileChange") {
    return <FileChangeProtocolBlock block={block} />;
  }
  const orchestration =
    block.kind === "dynamicToolCall" ? orchestrationToolCall(block.raw, block.status) : null;
  if (orchestration !== null) {
    return <OrchestrationProtocolBlock call={orchestration} />;
  }
  if (block.kind === "mcpToolCall" || block.kind === "dynamicToolCall") {
    return (
      <ToolCallProtocolBlock
        block={block}
        {...(getTransferAccess === undefined ? {} : { getTransferAccess })}
      />
    );
  }
  if (block.kind === "webSearch") {
    return <WebSearchProtocolBlock block={block} />;
  }
  if (block.kind === "collabAgentToolCall" || block.kind === "subAgentActivity") {
    // The subagent's own thread holds its prompt and result in full.
    return <AgentActivityProtocolBlock block={block} />;
  }
  if (block.kind === "imageView" || block.kind === "imageGeneration") {
    return (
      <ImageProtocolBlock
        block={block}
        {...(getTransferAccess === undefined ? {} : { getTransferAccess })}
      />
    );
  }
  if (block.kind === "unknown") {
    return (
      <UnknownProtocolBlock
        block={block}
        {...(getTransferAccess === undefined ? {} : { getTransferAccess })}
        {...(onFixUnsupportedBlock === undefined ? {} : { onFixUnsupportedBlock })}
      />
    );
  }
  const displayTitle =
    block.kind === "reasoning"
      ? reasoningActivityTitle(block.body, activeToolCall ? "inProgress" : block.status)
      : block.title;
  if (block.kind === "reasoning") {
    const running = activeToolCall || block.status === "inProgress" || block.status === "running";
    return <ThinkingStatus running={running} text={displayTitle} />;
  }
  return renderProtocolFallback(block, displayTitle, getTransferAccess);
}
