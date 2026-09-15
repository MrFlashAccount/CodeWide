import { View } from "react-native";
import { liveStreamMetricKey } from "../../../data/operational-metrics";
import {
  ArtifactImageReferences,
  artifactImageReferences,
} from "../../../rendering/ArtifactImageReferences";
import { BubbleContent } from "../../../rendering/Bubble";
import { MessageAttachmentCard } from "../../../rendering/MessageAttachmentCard";
import { MessageAttachmentGrid } from "../../../rendering/MessageAttachmentTile";
import { richMarkdownLayout } from "../../../rendering/rich-markdown-layout";
import { AppText as Text } from "../../../ui/Typography";
import { WaveText } from "../../../ui/WaveText";
import { AgentResponseMarkdown } from "../content/AgentResponseMarkdown";
import { CollapsedTurnActivity, CompletedTurnHistory } from "./CompletedTurnHistory";
import { LiveAgentResponse } from "./LiveAgentResponse";
import { PreTurnLifecycleRows } from "./PreTurnLifecycleRows";
import { TurnActivitySegment } from "./TurnActivity";
import { projectTurnPresentation } from "./turnProjection";
import { styles } from "./TurnTimelineItem.styles";
import type { TurnTimelineItemProps } from "./TurnTimelineItem.types";
import { UserImageGallery, userMessageAttachmentReference } from "./UserMessageContent";

/** Agent response body preserves ordered activity, streamed output and attachment presentation. */
export function renderAgentTurnBody(
  turn: TurnTimelineItemProps["turn"],
  presentation: ReturnType<typeof projectTurnPresentation>,
  {
    compact,
    forceExpanded,
    animateLiveUpdates,
    requestPrompt,
    getTransferAccess,
    onFixUnsupportedBlock,
    onLoadItems,
    latestAgentRef,
    onLatestAgentLayout,
  }: {
    requestPrompt: TurnTimelineItemProps["requestPrompt"];
    compact: boolean;
    forceExpanded: boolean;
    animateLiveUpdates: boolean;
    getTransferAccess: TurnTimelineItemProps["getTransferAccess"];
    onFixUnsupportedBlock: TurnTimelineItemProps["onFixUnsupportedBlock"];
    onLoadItems: TurnTimelineItemProps["onLoadItems"];
    latestAgentRef: TurnTimelineItemProps["latestAgentRef"];
    onLatestAgentLayout: TurnTimelineItemProps["onLatestAgentLayout"];
  },
) {
  return (
    <ArtifactImageReferences.Provider value={artifactImageReferences(presentation.artifacts)}>
      <BubbleContent>
        {presentation.preTurnBlocks.length > 0 && (
          <PreTurnLifecycleRows
            blocks={presentation.preTurnBlocks}
            turnStatus={presentation.rawTurn.status}
            turnKey={turn.key}
            {...(getTransferAccess === undefined ? {} : { getTransferAccess })}
            {...(onFixUnsupportedBlock === undefined ? {} : { onFixUnsupportedBlock })}
          />
        )}
        {presentation.rawTurn.status !== "inProgress" && (
          <CompletedTurnHistory
            item={turn}
            compact={compact}
            forceExpanded={forceExpanded}
            {...(getTransferAccess === undefined ? {} : { getTransferAccess })}
            {...(onFixUnsupportedBlock === undefined ? {} : { onFixUnsupportedBlock })}
            {...(onLoadItems === undefined ? {} : { onLoadItems })}
          />
        )}
        {presentation.searchedAgentBlock !== null && (
          <AgentResponseMarkdown
            block={presentation.searchedAgentBlock}
            {...(getTransferAccess === undefined ? {} : { getTransferAccess })}
          />
        )}
        {presentation.rawTurn.status !== "inProgress" &&
          presentation.latestAgentBlock !== null &&
          presentation.hasGeneratedAgentResponse && (
            <AgentResponseMarkdown
              block={presentation.latestAgentBlock}
              {...(getTransferAccess === undefined ? {} : { getTransferAccess })}
              {...(latestAgentRef === undefined ? {} : { visibilityRef: latestAgentRef })}
              {...(onLatestAgentLayout === undefined
                ? {}
                : { onVisibilityLayout: onLatestAgentLayout })}
            />
          )}
        {presentation.rawTurn.status === "inProgress" &&
          presentation.visibleLiveActivitySequence.map((part, index) =>
            part.kind === "collapsedActivity" ? (
              <CollapsedTurnActivity
                key={`${part.key}:${index}`}
                item={turn}
                indexes={part.indexes}
                compact={compact}
                forceExpanded={forceExpanded}
                {...(getTransferAccess === undefined ? {} : { getTransferAccess })}
                {...(onFixUnsupportedBlock === undefined ? {} : { onFixUnsupportedBlock })}
              />
            ) : part.kind === "agent" ? (
              <LiveAgentResponse
                key={`${part.key}:${index}`}
                cacheKey={part.block.key}
                fill={richMarkdownLayout(part.block.body ?? "") === "fill"}
                projection={presentation.liveMarkdownProjections.get(part.block.key)!}
                animateNew={animateLiveUpdates}
                streamMetricKey={
                  animateLiveUpdates
                    ? liveStreamMetricKey(
                        turn.connectionId,
                        turn.threadId,
                        presentation.rawTurn.id,
                        part.block.raw.id,
                      )
                    : null
                }
              />
            ) : (
              <TurnActivitySegment
                key={`${part.key}:${index}`}
                turnKey={turn.key}
                part={part}
                turnStatus={presentation.rawTurn.status}
                animateNew={animateLiveUpdates}
                compact={compact}
                forceExpanded={forceExpanded}
                {...(getTransferAccess === undefined ? {} : { getTransferAccess })}
                {...(onFixUnsupportedBlock === undefined ? {} : { onFixUnsupportedBlock })}
              />
            ),
          )}
        {presentation.artifacts.length > 0 && (
          <View testID="agent-artifacts" style={styles.userMessageContent}>
            <UserImageGallery
              attachments={presentation.artifacts.filter(
                (attachment) => attachment.kind === "image",
              )}
              {...(getTransferAccess === undefined ? {} : { getTransferAccess })}
            />
            {presentation.artifacts.some((attachment) => attachment.kind !== "image") && (
              <MessageAttachmentGrid>
                {presentation.artifacts
                  .filter((attachment) => attachment.kind !== "image")
                  .map((attachment) => (
                    <MessageAttachmentCard
                      key={userMessageAttachmentReference(attachment)}
                      attachment={attachment}
                      {...(getTransferAccess === undefined ? {} : { getAccess: getTransferAccess })}
                    />
                  ))}
              </MessageAttachmentGrid>
            )}
          </View>
        )}
        {requestPrompt}
        {presentation.showEmptyResponsePlaceholder && (
          <Text style={styles.agentPlaceholder}>
            {presentation.rawTurn.status === "interrupted"
              ? "Stopped before response was generated"
              : "No response was generated"}
          </Text>
        )}
        {!presentation.hasAgentContent && presentation.rawTurn.status === "inProgress" && (
          <WaveText
            testID="turn-thinking-placeholder"
            text="Thinking"
            style={styles.agentPlaceholder}
          />
        )}
      </BubbleContent>
    </ArtifactImageReferences.Provider>
  );
}
