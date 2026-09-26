import type { RenderBlock } from "@codewide/renderers";
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
import type { projectTurnPresentation } from "./turnProjection";
import { TurnMetricsProvider } from "./TurnMetricsProvider";
import { TurnFooter } from "./TurnFooter";
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
  onForkThroughTurn?: (turnId: string) => Promise<void>;
  onLatestAgentLayout?: TurnTimelineItemProps["onLatestAgentLayout"];
  onLoadItems?: (turnId: string) => Promise<void>;
  parts: readonly VirtualizedTurnPart[];
  placement: VirtualizedTurnPlacement;
  presentation: TurnPresentation;
  requestPrompt: ReactNode;
  turn: TurnTimelineItemProps["turn"];
  usage?: TurnUsageProjection | null;
};

/** Renders user and pre-turn content as a stable row before the agent response. */
export function VirtualizedTurnLeadItem(props: VirtualizedTurnLeadItemProps): ReactElement {
  const user =
    props.presentation.userBlocks.length === 0
      ? null
      : renderUserTurnBody(props.turn, props.presentation.userBlocks, props.getTransferAccess);
  const compaction =
    props.presentation.compactionBlocks.length === 0 ? null : (
      <PreTurnLifecycleRows
        blocks={props.presentation.compactionBlocks}
        turnKey={props.turn.key}
        turnStatus={props.presentation.rawTurn.status}
        {...(props.getTransferAccess === undefined
          ? {}
          : { getTransferAccess: props.getTransferAccess })}
        {...(props.onFixUnsupportedBlock === undefined
          ? {}
          : { onFixUnsupportedBlock: props.onFixUnsupportedBlock })}
      />
    );
  return (
    <View style={styles.virtualizedTurnLead}>
      {user}
      {compaction}
    </View>
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
        errorResetKey={`${props.turn.key}:agent:${props.placement}`}
        fill={presentation.agentBubbleFill}
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
  return renderAgentBoundary(
    props,
    <ImagePreviewGroup id={`${props.turn.key}:agent`}>{row}</ImagePreviewGroup>,
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
  if (latestAgentRef === undefined && onLatestAgentLayout === undefined) {
    return children;
  }
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
  props: Pick<VirtualizedTurnTimelineItemProps, "placement" | "turn">,
  content: ReactElement,
): ReactElement {
  const key = `${props.turn.key}:agent:${props.placement}`;
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
  onForkThroughTurn: ((turnId: string) => Promise<void>) | undefined;
  placement: VirtualizedTurnPlacement;
  presentation: TurnPresentation;
  turn: TurnTimelineItemProps["turn"];
}): ReactElement | null {
  const beginContentReview = useContentReview();
  const fork = useEvent(async () => {
    if (onForkThroughTurn === undefined) {
      throw new Error("Thread fork is unavailable");
    }
    await onForkThroughTurn(turn.id);
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

function renderVirtualizedTurnFooter(
  presentation: TurnPresentation,
  turn: TurnTimelineItemProps["turn"],
  usage: TurnUsageProjection | null,
): ReactElement {
  return (
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
  return isTrailingSlice(placement) ? renderVirtualizedTurnFooter(presentation, turn, usage) : null;
}

function isLeadingSlice(placement: VirtualizedTurnPlacement): boolean {
  return placement === "single" || placement === "start";
}

function isTrailingSlice(placement: VirtualizedTurnPlacement): boolean {
  return placement === "end" || placement === "single";
}
