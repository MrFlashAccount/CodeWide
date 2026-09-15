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
import { TurnUsageContext } from "./turnContexts";
import { TurnFooter } from "./TurnFooter";
import { styles } from "./TurnTimelineItem.styles";

export function TurnTimelineItem({
  turn,
  agentDateLabel = null,
  compact,
  animateLiveUpdates,
  usage = null,
  forceExpanded = false,
  requestPrompt,
  getTransferAccess,
  onFixUnsupportedBlock,
  onForkThroughTurn,
  onLoadItems,
  latestAgentRef,
  onLatestAgentLayout,
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
    <TurnUsageContext.Provider value={usage}>
      <PrivateAssetRecoveryProvider
        {...(onLoadItems === undefined ? {} : { recover: () => onLoadItems(turn.id) })}
      >
        <View testID="turn-group" style={styles.turnGroup}>
          {presentation.userBlocks.length > 0 &&
            renderUserTurnBody(turn, presentation.userBlocks, getTransferAccess)}
          {presentation.compactionBlocks.length > 0 && (
            <PreTurnLifecycleRows
              blocks={presentation.compactionBlocks}
              turnStatus={presentation.rawTurn.status}
              turnKey={turn.key}
              {...(getTransferAccess === undefined ? {} : { getTransferAccess })}
              {...(onFixUnsupportedBlock === undefined ? {} : { onFixUnsupportedBlock })}
            />
          )}
          {agentDateLabel === null ? null : <TimelineDateSeparator label={agentDateLabel} />}
          <RecoverableRenderBoundary
            scope="bubble"
            label="Agent message"
            context={`Thread: ${turn.threadId}\nTurn: ${turn.id}`}
            resetKey={`${turn.key}:agent`}
          >
            <ImagePreviewGroup id={`${turn.key}:agent`}>
              <View style={styles.agentMessageRow}>
                <Bubble
                  variant="agent"
                  fill={presentation.agentBubbleFill}
                  animateLayout={presentation.rawTurn.status === "inProgress" && animateLiveUpdates}
                  testID="codex-bubble"
                  errorContext={`Thread: ${turn.threadId}\nTurn: ${turn.id}`}
                  errorResetKey={`${turn.key}:agent`}
                  footer={
                    <TurnFooter
                      status={presentation.rawTurn.status}
                      durationMs={presentation.rawTurn.durationMs}
                      completedAt={presentation.rawTurn.completedAt}
                      usage={usage}
                      diff={projectedTurnMetadata(presentation.rawTurn)?.diff ?? ""}
                      changesTarget={{
                        connectionId: turn.connectionId,
                        threadId: turn.threadId,
                        turnId: turn.id,
                      }}
                    />
                  }
                >
                  {renderAgentTurnBody(turn, presentation, {
                    compact,
                    forceExpanded,
                    animateLiveUpdates,
                    requestPrompt,
                    getTransferAccess,
                    onFixUnsupportedBlock,
                    onLoadItems,
                    latestAgentRef,
                    onLatestAgentLayout,
                  })}
                </Bubble>
                {presentation.showMessageActions && (
                  <MessageActionRail
                    request={{
                      copyText: presentation.copyText,
                      ...(presentation.canForkThrough && onForkThroughTurn !== undefined
                        ? { onFork: () => onForkThroughTurn(turn.id) }
                        : {}),
                      ...(presentation.canReviewResponse && agentReviewTarget !== null
                        ? {
                            onReview: async () => {
                              await beginContentReview({
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
    </TurnUsageContext.Provider>
  );
}
