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
import { groupFooterFacts, groupTailTurn, type TurnBubbleGroup } from "./turnBubbleGroup";
import { projectTurnPresentation } from "./turnProjection";
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
  /** The slice's place in its response bubble (corners, footer, actions, date). */
  bubble: VirtualizedTurnPlacement;
  compact: boolean;
  followsLead: boolean;
  forceExpanded: boolean;
  getTransferAccess?: TurnTimelineItemProps["getTransferAccess"];
  /** The turns sharing this bubble, or `null` for a turn drawn alone. */
  group: TurnBubbleGroup | null;
  latestAgentRef?: TurnTimelineItemProps["latestAgentRef"];
  onFixUnsupportedBlock?: (block: RenderBlock) => Promise<void>;
  onForkThroughTurn?: (turnId: string) => Promise<void>;
  onLatestAgentLayout?: TurnTimelineItemProps["onLatestAgentLayout"];
  onLoadItems?: (turnId: string) => Promise<void>;
  parts: readonly VirtualizedTurnPart[];
  /** The slice's place within its own turn (history, artifacts, response gaps). */
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
        isLeadingSlice(props.bubble) && !props.followsLead
          ? styles.turnGroup
          : styles.virtualizedTurnSegment,
        isLeadingSlice(props.bubble) && props.followsLead ? styles.virtualizedTurnAfterLead : null,
      ]}
      testID="turn-group"
    >
      {isLeadingSlice(props.bubble) && agentDateLabel !== null ? (
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
      group={props.group}
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
        fill={presentation.agentBubbleFill}
        footer={renderFooterForPlacement({
          group: props.group,
          placement: props.bubble,
          presentation,
          turn: props.turn,
          usage,
        })}
        segment={props.bubble}
        testID="codex-bubble"
        variant="agent"
      >
        {visibleBody}
      </Bubble>
      <VirtualizedMessageActions
        onForkThroughTurn={props.onForkThroughTurn}
        placement={props.bubble}
        {...groupActionTarget({
          canFork: props.onForkThroughTurn !== undefined,
          group: props.group,
          presentation,
          turn: props.turn,
        })}
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

/**
 * The turn a bubble's actions act on: the latest turn of a group, so copying
 * or forking a continued response includes the continuation.
 */
function groupActionTarget({
  canFork,
  group,
  presentation,
  turn,
}: {
  readonly canFork: boolean;
  readonly group: TurnBubbleGroup | null;
  readonly presentation: TurnPresentation;
  readonly turn: TurnTimelineItemProps["turn"];
}): { readonly presentation: TurnPresentation; readonly turn: TurnTimelineItemProps["turn"] } {
  const tail = group === null ? undefined : groupTailTurn(group);
  if (tail === undefined || tail === turn) {
    return { presentation, turn };
  }
  return { presentation: projectTurnPresentation(tail, null, canFork, false), turn: tail };
}

function renderVirtualizedTurnFooter({
  group,
  presentation,
  turn,
  usage,
}: {
  group: TurnBubbleGroup | null;
  presentation: TurnPresentation;
  turn: TurnTimelineItemProps["turn"];
  usage: TurnUsageProjection | null;
}): ReactElement {
  const facts = footerFacts(presentation, usage, group);
  const metadata = projectedTurnMetadata(presentation.rawTurn);
  return (
    <TurnFooter
      changesTarget={{
        connectionId: turn.connectionId,
        threadId: turn.threadId,
        turnId: turn.id,
      }}
      completedAt={facts.completedAt}
      diff={metadata?.diff ?? ""}
      durationMs={facts.durationMs}
      model={metadata?.execution?.model ?? null}
      status={presentation.rawTurn.status}
      usage={facts.usage}
    />
  );
}

/**
 * A group's footer is drawn on its latest turn's last slice: that turn's
 * status and time, with the duration and usage of the whole bubble.
 */
function footerFacts(
  presentation: TurnPresentation,
  usage: TurnUsageProjection | null,
  group: TurnBubbleGroup | null,
): NonNullable<ReturnType<typeof groupFooterFacts>> {
  const facts = group === null ? null : groupFooterFacts(group);
  return (
    facts ?? {
      completedAt: presentation.rawTurn.completedAt,
      durationMs: presentation.rawTurn.durationMs,
      usage,
    }
  );
}

function renderFooterForPlacement({
  group,
  placement,
  presentation,
  turn,
  usage,
}: {
  group: TurnBubbleGroup | null;
  placement: VirtualizedTurnPlacement;
  presentation: TurnPresentation;
  turn: TurnTimelineItemProps["turn"];
  usage: TurnUsageProjection | null;
}): ReactElement | null {
  return isTrailingSlice(placement)
    ? renderVirtualizedTurnFooter({ group, presentation, turn, usage })
    : null;
}

function isLeadingSlice(placement: VirtualizedTurnPlacement): boolean {
  return placement === "single" || placement === "start";
}

function isTrailingSlice(placement: VirtualizedTurnPlacement): boolean {
  return placement === "end" || placement === "single";
}
