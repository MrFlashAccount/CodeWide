import { renderAgentTurnBody } from "./AgentTurnBody";
import { projectTurnPresentation } from "./turnProjection";
import type { TurnTimelineItemProps } from "./TurnTimelineItem.types";
import { renderUserTurnBody } from "./UserTurnBody";
/** V1 TurnTimelineItem owner, extracted without changing interaction or resource lifetime. */
import { projectedTurnMetadata } from "@codewide/sync-client";
import { useContext } from "react";
import { View } from "react-native";
import { Bubble } from "../../../rendering/Bubble";
import { useContentReview } from "../../../rendering/ContentReviewHost";
import { ImagePreviewGroup } from "../../../rendering/ImagePreviewHost";
import { SearchMessageFocus } from "../../../rendering/SearchMessageFocus";
import { TimelineDateSeparator } from "../../../rendering/TimelineDateSeparator";
import { PrivateAssetRecoveryProvider } from "../../../rendering/use-private-image-uri";
import { RecoverableRenderBoundary } from "../../../ui/RecoverableRenderBoundary";
import { MessageActionRail } from "./MessageActionRail";
import { PreTurnLifecycleRows } from "./PreTurnLifecycleRows";
import { TurnMetricsProvider } from "./TurnMetricsProvider";
import { TurnFooter } from "./TurnFooter";
import { styles } from "./TurnTimelineItem.styles";

export function TurnTimelineItem({
  agentDateLabel = null,
  animateLiveUpdates,
  compact,
  forceExpanded = false,
  getTransferAccess,
  latestAgentRef,
  onFixUnsupportedBlock,
  onForkThroughTurn,
  onLatestAgentLayout,
  onLoadItems,
  requestPrompt,
  turn,
  usage = null,
}: TurnTimelineItemProps) {
  const beginContentReview = useContentReview();
  const searchFocus = useContext(SearchMessageFocus);
  const presentation = projectTurnPresentation(
    turn,
    searchFocus,
    onForkThroughTurn !== undefined,
    requestPrompt !== null,
  );

  const agentReviewTarget = presentation.agentReviewTarget;
  return (
    <TurnMetricsProvider turn={turn.turn} usage={usage}>
      <PrivateAssetRecoveryProvider
        {...(onLoadItems === undefined ? {} : { recover: async () => onLoadItems(turn.id) })}
      >
        <View style={styles.turnGroup} testID="turn-group">
          {presentation.userBlocks.length > 0 &&
            renderUserTurnBody(turn, presentation.userBlocks, getTransferAccess)}
          {presentation.compactionBlocks.length > 0 && (
            <PreTurnLifecycleRows
              blocks={presentation.compactionBlocks}
              turnKey={turn.key}
              turnStatus={presentation.rawTurn.status}
              {...(getTransferAccess === undefined ? {} : { getTransferAccess })}
              {...(onFixUnsupportedBlock === undefined ? {} : { onFixUnsupportedBlock })}
            />
          )}
          {agentDateLabel === null ? null : <TimelineDateSeparator label={agentDateLabel} />}
          <RecoverableRenderBoundary
            context={`Thread: ${turn.threadId}\nTurn: ${turn.id}`}
            label="Agent message"
            resetKey={`${turn.key}:agent`}
            scope="bubble"
          >
            <ImagePreviewGroup id={`${turn.key}:agent`}>
              <View style={styles.agentMessageRow}>
                <Bubble
                  animateLayout={presentation.rawTurn.status === "inProgress" && animateLiveUpdates}
                  errorContext={`Thread: ${turn.threadId}\nTurn: ${turn.id}`}
                  errorResetKey={`${turn.key}:agent`}
                  fill={presentation.agentBubbleFill}
                  footer={
                    <TurnFooter
                      changesTarget={{
                        connectionId: turn.connectionId,
                        threadId: turn.threadId,
                        turnId: turn.id,
                      }}
                      completedAt={presentation.rawTurn.completedAt}
                      diff={projectedTurnMetadata(presentation.rawTurn)?.diff ?? ""}
                      durationMs={presentation.rawTurn.durationMs}
                      status={presentation.rawTurn.status}
                      usage={usage}
                    />
                  }
                  testID="codex-bubble"
                  variant="agent"
                >
                  {renderAgentTurnBody(turn, presentation, {
                    animateLiveUpdates,
                    compact,
                    forceExpanded,
                    getTransferAccess,
                    latestAgentRef,
                    onFixUnsupportedBlock,
                    onLatestAgentLayout,
                    onLoadItems,
                    requestPrompt,
                  })}
                </Bubble>
                {presentation.showMessageActions && (
                  <MessageActionRail
                    request={{
                      copyText: presentation.copyText,
                      ...(presentation.canForkThrough && onForkThroughTurn !== undefined
                        ? { onFork: async () => onForkThroughTurn(turn.id) }
                        : {}),
                      ...(presentation.canReviewResponse && agentReviewTarget !== null
                        ? {
                            onReview: () => {
                              beginContentReview({
                                kind: "response",
                                target: agentReviewTarget,
                              });
                            },
                          }
                        : {}),
                    }}
                  />
                )}
              </View>
            </ImagePreviewGroup>
          </RecoverableRenderBoundary>
        </View>
      </PrivateAssetRecoveryProvider>
    </TurnMetricsProvider>
  );
}
