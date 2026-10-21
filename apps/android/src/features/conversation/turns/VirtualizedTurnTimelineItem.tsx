import type { RenderBlock } from "@codewide/renderers";
import type { TaskNotificationReport } from "../../../rendering/taskNotifications";
import { projectedTurnMetadata, type TurnUsageProjection } from "@codewide/sync-client";
import type { ReactElement, ReactNode } from "react";
import { View } from "react-native";
import { useEvent } from "../../../react/useEvent";
import { Bubble } from "../../../rendering/Bubble";
import { useContentReview } from "../../../rendering/ContentReviewHost";
import { ImagePreviewGroup } from "../../../rendering/ImagePreviewHost";
import { TimelineDateSeparator } from "../../../rendering/TimelineDateSeparator";
import { PrivateAssetRecoveryProvider } from "../../../rendering/use-private-image-uri";
import { RecoverableRenderBoundary } from "../../../ui/RecoverableRenderBoundary";
import { MessageActionRail } from "./MessageActionRail";
import { PreTurnLifecycleRows } from "./PreTurnLifecycleRows";
import { TaskNotificationLine } from "./TaskNotificationLine";
import type { projectTurnPresentation } from "./turnProjection";
import { TurnMetricsProvider } from "./TurnMetricsProvider";
import { TurnFooter } from "./TurnFooter";
import { turnModelName } from "./turnModelName";
import { styles } from "./TurnTimelineItem.styles";
import type { TurnTimelineItemProps } from "./TurnTimelineItem.types";
import { renderUserTurnBody } from "./UserTurnBody";
import { VirtualizedAgentTurnBody } from "./VirtualizedAgentTurnBody";
import type { VirtualizedTurnPart, VirtualizedTurnPlacement } from "./virtualizedTurnTypes";

type TurnPresentation = ReturnType<typeof projectTurnPresentation>;

type VirtualizedTurnLeadItemProps = Pick<
  TurnTimelineItemProps,
  "getTransferAccess" | "onFixUnsupportedBlock" | "turn"
> & {
  /** The background task reports that woke this turn; drawn instead of a person's message. */
  notifications: readonly TaskNotificationReport[];
  presentation: TurnPresentation;
};

type VirtualizedTurnTimelineItemProps = {
  agentDateLabel?: string | null;
  animateLiveUpdates: boolean;
  compact: boolean;
  followsLead: boolean;
  forceExpanded: boolean;
  getTransferAccess?: TurnTimelineItemProps["getTransferAccess"];
  latestAgentRef?: TurnTimelineItemProps["latestAgentRef"];
  onFixUnsupportedBlock?: (block: RenderBlock) => Promise<void>;
  onForkThroughTurn?: (turnId: string) => void;
  onLatestAgentLayout?: TurnTimelineItemProps["onLatestAgentLayout"];
  onLoadItems?: (turnId: string) => Promise<void>;
  parts: readonly VirtualizedTurnPart[];
  /** The slice's place in its turn's bubble (corners, footer, actions, date, history). */
  placement: VirtualizedTurnPlacement;
  presentation: TurnPresentation;
  requestPrompt: ReactNode;
  turn: TurnTimelineItemProps["turn"];
  usage?: TurnUsageProjection | null;
};

/** Renders user, wake reason and pre-turn content as a stable row before the agent response. */
export function VirtualizedTurnLeadItem(props: VirtualizedTurnLeadItemProps): ReactElement {
  const user =
    props.presentation.userBlocks.length === 0
      ? null
      : renderUserTurnBody(props.turn, props.presentation.userBlocks, props.getTransferAccess);
  return (
    <View style={styles.virtualizedTurnLead}>
      {user}
      <TaskNotificationLine reports={props.notifications} />
      {renderCompactionLines(props, props.presentation.leadCompactionBlocks)}
    </View>
  );
}

/** Context compactions are system lifecycle lines outside the bubble, never turn activity. */
function renderCompactionLines(
  props: {
    readonly getTransferAccess?: TurnTimelineItemProps["getTransferAccess"] | undefined;
    readonly onFixUnsupportedBlock?: TurnTimelineItemProps["onFixUnsupportedBlock"] | undefined;
    readonly turn: TurnTimelineItemProps["turn"];
  },
  blocks: RenderBlock[],
): ReactElement | null {
  if (blocks.length === 0) {
    return null;
  }
  return (
    <PreTurnLifecycleRows
      blocks={blocks}
      turnKey={props.turn.key}
      turnStatus={props.turn.turn.status}
      {...(props.getTransferAccess === undefined
        ? {}
        : { getTransferAccess: props.getTransferAccess })}
      {...(props.onFixUnsupportedBlock === undefined
        ? {}
        : { onFixUnsupportedBlock: props.onFixUnsupportedBlock })}
    />
  );
}

/** Renders one physical LegendList slice of the unified V1 turn model. */
export function VirtualizedTurnTimelineItem({
  agentDateLabel = null,
  usage = null,
  ...props
}: VirtualizedTurnTimelineItemProps): ReactElement {
  const recover = useEvent(async () => {
    if (props.onLoadItems === undefined) {
      throw new Error("Turn activity is unavailable");
    }
    await props.onLoadItems(props.turn.id);
  });
  const content = (
    <PrivateAssetRecoveryProvider {...(props.onLoadItems === undefined ? {} : { recover })}>
      <VirtualizedTurnSlice {...props} agentDateLabel={agentDateLabel} usage={usage} />
    </PrivateAssetRecoveryProvider>
  );
  return (
    <TurnMetricsProvider turn={props.turn.turn} usage={usage}>
      {content}
    </TurnMetricsProvider>
  );
}

function VirtualizedTurnSlice({
  agentDateLabel,
  presentation,
  usage,
  ...props
}: Omit<VirtualizedTurnTimelineItemProps, "agentDateLabel" | "usage"> & {
  agentDateLabel: string | null;
  usage: TurnUsageProjection | null;
}): ReactElement {
  return (
    <View
      style={[
        isLeadingSlice(props.placement) && !props.followsLead
          ? styles.turnGroup
          : styles.virtualizedTurnSegment,
        isLeadingSlice(props.placement) && props.followsLead
          ? styles.virtualizedTurnAfterLead
          : null,
      ]}
      testID="turn-group"
    >
      {isLeadingSlice(props.placement) && agentDateLabel !== null ? (
        <TimelineDateSeparator label={agentDateLabel} />
      ) : null}
      <VirtualizedAgentMessage {...props} presentation={presentation} usage={usage} />
    </View>
  );
}

function VirtualizedAgentMessage({
  presentation,
  usage,
  ...props
}: Omit<VirtualizedTurnTimelineItemProps, "agentDateLabel" | "usage"> & {
  usage: TurnUsageProjection | null;
}): ReactElement {
  const body = (
    <VirtualizedAgentTurnBody
      animateLiveUpdates={props.animateLiveUpdates}
      compact={props.compact}
      forceExpanded={props.forceExpanded}
      getTransferAccess={props.getTransferAccess}
      onFixUnsupportedBlock={props.onFixUnsupportedBlock}
      onLoadItems={props.onLoadItems}
      parts={props.parts}
      placement={props.placement}
      presentation={presentation}
      requestPrompt={props.requestPrompt}
      turn={props.turn}
    />
  );
  const visibleBody = (
    <LatestAgentVisibilityBoundary
      latestAgentRef={props.latestAgentRef}
      onLatestAgentLayout={props.onLatestAgentLayout}
    >
      {body}
    </LatestAgentVisibilityBoundary>
  );
  const row = (
    <View style={styles.agentMessageRow}>
      <Bubble
        animateLayout={presentation.rawTurn.status === "inProgress" && props.animateLiveUpdates}
        errorContext={`Thread: ${props.turn.threadId}\nTurn: ${props.turn.id}`}
        errorResetKey={`${props.turn.key}:agent`}
        // The slices of one bubble share its width: one carrying an approval
        // card spans the row.
        fill={
          presentation.agentBubbleFill ||
          (props.requestPrompt !== null && props.requestPrompt !== undefined)
        }
        footer={renderFooterForPlacement({
          placement: props.placement,
          presentation,
          turn: props.turn,
          usage,
        })}
        segment={props.placement}
        testID="codex-bubble"
        variant="agent"
      >
        {visibleBody}
      </Bubble>
      <VirtualizedMessageActions
        onForkThroughTurn={props.onForkThroughTurn}
        placement={props.placement}
        presentation={presentation}
        turn={props.turn}
      />
    </View>
  );
  // Reports that arrived while a person's turn answered follow its bubble; a
  // wake turn lists them on its reason line instead.
  const midTurn =
    isTrailingSlice(props.placement) && presentation.userBlocks.length > 0
      ? presentation.taskNotifications.midTurn
      : [];
  return renderAgentBoundary(
    props,
    <ImagePreviewGroup id={`${props.turn.key}:agent`}>
      {row}
      <TaskNotificationLine reports={midTurn} />
    </ImagePreviewGroup>,
  );
}

function LatestAgentVisibilityBoundary({
  children,
  latestAgentRef,
  onLatestAgentLayout,
}: {
  children: ReactElement;
  latestAgentRef: TurnTimelineItemProps["latestAgentRef"];
  onLatestAgentLayout: TurnTimelineItemProps["onLatestAgentLayout"];
}): ReactElement {
  // Receipt observation may attach after completion and detach after acknowledgement.
  // Keep the same native parent so neither transition replaces already displayed text.
  return (
    <View
      collapsable={false}
      {...(onLatestAgentLayout === undefined ? {} : { onLayout: onLatestAgentLayout })}
      {...(latestAgentRef === undefined ? {} : { ref: latestAgentRef })}
    >
      {children}
    </View>
  );
}

function renderAgentBoundary(
  props: Pick<VirtualizedTurnTimelineItemProps, "turn">,
  content: ReactElement,
): ReactElement {
  // LegendList's row key owns slice identity. Placement only changes corners/footer;
  // single -> start must not reset either this boundary or Bubble's inner boundary.
  const key = `${props.turn.key}:agent`;
  return (
    <RecoverableRenderBoundary
      context={`Thread: ${props.turn.threadId}\nTurn: ${props.turn.id}`}
      label="Agent message"
      resetKey={key}
      scope="bubble"
    >
      {content}
    </RecoverableRenderBoundary>
  );
}

function VirtualizedMessageActions({
  onForkThroughTurn,
  placement,
  presentation,
  turn,
}: {
  onForkThroughTurn: ((turnId: string) => void) | undefined;
  placement: VirtualizedTurnPlacement;
  presentation: TurnPresentation;
  turn: TurnTimelineItemProps["turn"];
}): ReactElement | null {
  const beginContentReview = useContentReview();
  const fork = useEvent(() => {
    if (onForkThroughTurn === undefined) {
      throw new Error("Thread fork is unavailable");
    }
    onForkThroughTurn(turn.id);
  });
  const review = useEvent(() => {
    if (presentation.agentReviewTarget === null) {
      throw new Error("Response review is unavailable");
    }
    beginContentReview({ kind: "response", target: presentation.agentReviewTarget });
  });
  if (!presentation.showMessageActions) {
    return null;
  }
  if (!isLeadingSlice(placement)) {
    return <View style={styles.virtualizedActionRailPlaceholder} />;
  }
  const request = {
    copyText: presentation.copyText,
    ...(presentation.canForkThrough && onForkThroughTurn !== undefined ? { onFork: fork } : {}),
    ...(presentation.canReviewResponse && presentation.agentReviewTarget !== null
      ? { onReview: review }
      : {}),
  };
  return <MessageActionRail request={request} />;
}

function renderVirtualizedTurnFooter({
  presentation,
  turn,
  usage,
}: {
  presentation: TurnPresentation;
  turn: TurnTimelineItemProps["turn"];
  usage: TurnUsageProjection | null;
}): ReactElement {
  const metadata = projectedTurnMetadata(presentation.rawTurn);
  return (
    <TurnFooter
      changesTarget={{
        connectionId: turn.connectionId,
        threadId: turn.threadId,
        turnId: turn.id,
      }}
      completedAt={presentation.rawTurn.completedAt}
      diff={metadata?.diff ?? ""}
      durationMs={presentation.rawTurn.durationMs}
      model={turnModelName(metadata?.execution)}
      status={presentation.rawTurn.status}
      usage={usage}
    />
  );
}

function renderFooterForPlacement({
  placement,
  presentation,
  turn,
  usage,
}: {
  placement: VirtualizedTurnPlacement;
  presentation: TurnPresentation;
  turn: TurnTimelineItemProps["turn"];
  usage: TurnUsageProjection | null;
}): ReactElement | null {
  return isTrailingSlice(placement)
    ? renderVirtualizedTurnFooter({ presentation, turn, usage })
    : null;
}

function isLeadingSlice(placement: VirtualizedTurnPlacement): boolean {
  return placement === "single" || placement === "start";
}

function isTrailingSlice(placement: VirtualizedTurnPlacement): boolean {
  return placement === "end" || placement === "single";
}
