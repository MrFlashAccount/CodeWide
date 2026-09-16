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
import type { projectTurnPresentation } from "./turnProjection";
import { styles } from "./TurnTimelineItem.styles";
import type { TurnTimelineItemProps } from "./TurnTimelineItem.types";
import { UserImageGallery, userMessageAttachmentReference } from "./UserMessageContent";

/** Agent response body preserves ordered activity, streamed output and attachment presentation. */
export function renderAgentTurnBody(
  turn: TurnTimelineItemProps["turn"],
  presentation: ReturnType<typeof projectTurnPresentation>,
  {
    animateLiveUpdates,
    compact,
    forceExpanded,
    getTransferAccess,
    latestAgentRef,
    onFixUnsupportedBlock,
    onLatestAgentLayout,
    onLoadItems,
    requestPrompt,
  }: {
    animateLiveUpdates: boolean;
    compact: boolean;
    forceExpanded: boolean;
    getTransferAccess: TurnTimelineItemProps["getTransferAccess"];
    latestAgentRef: TurnTimelineItemProps["latestAgentRef"];
    onFixUnsupportedBlock: TurnTimelineItemProps["onFixUnsupportedBlock"];
    onLatestAgentLayout: TurnTimelineItemProps["onLatestAgentLayout"];
    onLoadItems: TurnTimelineItemProps["onLoadItems"];
    requestPrompt: TurnTimelineItemProps["requestPrompt"];
  },
) {
  return (
    <ArtifactImageReferences.Provider value={artifactImageReferences(presentation.artifacts)}>
      <BubbleContent>
        {presentation.preTurnBlocks.length > 0 && (
          <PreTurnLifecycleRows
            blocks={presentation.preTurnBlocks}
            turnKey={turn.key}
            turnStatus={presentation.rawTurn.status}
            {...(getTransferAccess === undefined ? {} : { getTransferAccess })}
            {...(onFixUnsupportedBlock === undefined ? {} : { onFixUnsupportedBlock })}
          />
        )}
        {presentation.rawTurn.status !== "inProgress" && (
          <CompletedTurnHistory
            compact={compact}
            forceExpanded={forceExpanded}
            item={turn}
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
          presentation.visibleLiveActivitySequence.map((part) =>
            part.kind === "collapsedActivity" ? (
              <CollapsedTurnActivity
                compact={compact}
                forceExpanded={forceExpanded}
                indexes={part.indexes}
                item={turn}
                key={part.key}
                {...(getTransferAccess === undefined ? {} : { getTransferAccess })}
                {...(onFixUnsupportedBlock === undefined ? {} : { onFixUnsupportedBlock })}
              />
            ) : part.kind === "agent" ? (
              <LiveAgentResponse
                animateNew={animateLiveUpdates}
                cacheKey={part.block.key}
                fill={richMarkdownLayout(part.block.body) === "fill"}
                key={part.key}
                projection={liveMarkdownProjection(presentation, part.block.key)}
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
                animateNew={animateLiveUpdates}
                compact={compact}
                forceExpanded={forceExpanded}
                key={part.key}
                part={part}
                turnKey={turn.key}
                turnStatus={presentation.rawTurn.status}
                {...(getTransferAccess === undefined ? {} : { getTransferAccess })}
                {...(onFixUnsupportedBlock === undefined ? {} : { onFixUnsupportedBlock })}
              />
            ),
          )}
        {presentation.artifacts.length > 0 && (
          <View style={styles.userMessageContent} testID="agent-artifacts">
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
                      attachment={attachment}
                      key={userMessageAttachmentReference(attachment)}
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
            style={styles.agentPlaceholder}
            testID="turn-thinking-placeholder"
            text="Thinking"
          />
        )}
      </BubbleContent>
    </ArtifactImageReferences.Provider>
  );
}

function liveMarkdownProjection(
  presentation: ReturnType<typeof projectTurnPresentation>,
  blockKey: string,
) {
  const projection = presentation.liveMarkdownProjections.get(blockKey);
  if (projection === undefined) {
    throw new Error(`Live Markdown projection is missing for block ${blockKey}`);
  }
  return projection;
}
