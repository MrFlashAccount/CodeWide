import { blockActivitySummary } from "../../../rendering/activityMetrics";
/** V1 TurnActivity owner, extracted without changing interaction or resource lifetime. */
import type { RenderBlock } from "@codewide/renderers";
import type { ActivityFootprint } from "@codewide/sync-client";
import { useContext, useState, type ReactElement } from "react";
import { Pressable, View } from "react-native";
import { TimelineMotionContext } from "../../../rendering/FluidLayoutFrame";
import { NativeRevealSurface } from "../../../rendering/NativeRevealSurface";
import type { TurnSequencePart } from "../../../rendering/turn-sequence";
import { colors } from "../../../theme";
import { useEvent } from "../../../react/useEvent";
import { InlineIcon } from "../../../ui/InlineIcon";
import { AppText as Text } from "../../../ui/Typography";
import { WaveText } from "../../../ui/WaveText";
import { OutputFootprintMetric } from "../protocol/CommandOutput";
import { ProtocolBlock } from "../protocol/ProtocolBlock";
import { usePersistentExpansion } from "./Card";
import { ActivityDetailSheet } from "./ActivityDetailSheet";
import { styles } from "./TurnActivity.styles";
import {
  ActiveToolCallContext,
  TurnActivityMetricsContext,
  ExpansionItemKeyContext,
  ForceExpandCardsContext,
  TurnActivityContentContext,
} from "./turnContexts";
import { turnActivityLabel } from "./turnProjection";

export function TurnActivitySegment({
  animateNew,
  compact,
  forceExpanded,
  getTransferAccess,
  onFixUnsupportedBlock,
  part,
  turnKey,
  turnStatus,
}: {
  animateNew: boolean;
  compact: boolean;
  forceExpanded: boolean;
  getTransferAccess?: () => Promise<{ authorization: string; baseUrl: string }>;
  onFixUnsupportedBlock?: (block: RenderBlock) => Promise<void>;
  part: Extract<TurnSequencePart, { kind: "activity" }>;
  turnKey: string;
  turnStatus: "completed" | "interrupted" | "failed" | "inProgress";
}): ReactElement {
  const insideActivity = useContext(TurnActivityContentContext);
  const metrics = useContext(TurnActivityMetricsContext);
  const summary = blockActivitySummary(part.blocks, metrics);
  const label = turnActivityLabel(
    summary?.kinds ?? part.blocks.map((block) => block.kind),
    compact,
    summary?.count,
  );
  const outputFootprint = summary?.outputFootprint ?? null;
  const props = {
    animateNew,
    forceExpanded,
    label,
    outputFootprint,
    part,
    turnKey,
    turnStatus,
    ...(getTransferAccess === undefined ? {} : { getTransferAccess }),
    ...(onFixUnsupportedBlock === undefined ? {} : { onFixUnsupportedBlock }),
  };
  return insideActivity && !forceExpanded ? (
    <SheetActivitySegment {...props} />
  ) : (
    <InlineActivitySegment {...props} />
  );
}

type ActivitySegmentProps = {
  animateNew: boolean;
  forceExpanded: boolean;
  getTransferAccess?: () => Promise<{ authorization: string; baseUrl: string }>;
  label: string;
  onFixUnsupportedBlock?: (block: RenderBlock) => Promise<void>;
  outputFootprint: ActivityFootprint | null;
  part: Extract<TurnSequencePart, { kind: "activity" }>;
  turnKey: string;
  turnStatus: "completed" | "interrupted" | "failed" | "inProgress";
};

function SheetActivitySegment(props: ActivitySegmentProps): ReactElement {
  const [detailVisible, setDetailVisible] = useState(false);
  const openDetail = useEvent(() => {
    setDetailVisible(true);
  });
  const closeDetail = useEvent(() => {
    setDetailVisible(false);
  });
  return (
    <>
      <TurnActivity
        expanded={false}
        label={props.label}
        onToggle={openDetail}
        outputFootprint={props.outputFootprint}
      >
        {null}
      </TurnActivity>
      <ActivityDetailSheet
        blocks={props.part.blocks}
        onClose={closeDetail}
        turnKey={props.turnKey}
        turnStatus={props.turnStatus}
        visible={detailVisible}
        {...(props.getTransferAccess === undefined
          ? {}
          : { getTransferAccess: props.getTransferAccess })}
        {...(props.onFixUnsupportedBlock === undefined
          ? {}
          : { onFixUnsupportedBlock: props.onFixUnsupportedBlock })}
      />
    </>
  );
}

function InlineActivitySegment(props: ActivitySegmentProps): ReactElement {
  const kind = activitySegmentKind(props.part.blocks);
  if (kind === "thinking") {
    return <ThinkingActivitySegment {...props} />;
  }
  if (kind === "agentNavigation") {
    return <AgentNavigationActivitySegment {...props} />;
  }
  return <DisclosureActivitySegment {...props} />;
}

function ThinkingActivitySegment(props: ActivitySegmentProps): ReactElement {
  return (
    <View style={styles.thinkingStatusSection} testID="thinking-status-section">
      {props.part.blocks.map((block, index) => (
        <ThinkingActivityBlock
          active={props.turnStatus === "inProgress" && index === props.part.blocks.length - 1}
          block={block}
          key={block.key}
        />
      ))}
    </View>
  );
}

function ThinkingActivityBlock({
  active,
  block,
}: {
  active: boolean;
  block: RenderBlock;
}): ReactElement {
  return (
    <ActiveToolCallContext.Provider value={active}>
      <ProtocolBlock block={block} />
    </ActiveToolCallContext.Provider>
  );
}

function AgentNavigationActivitySegment(props: ActivitySegmentProps): ReactElement {
  const motionAllowed = useContext(TimelineMotionContext);
  return (
    <View style={styles.turnActivityList} testID="subagent-activity-navigation">
      {props.part.blocks.map((block) => (
        <RevealedActivityBlock
          animate={props.animateNew && motionAllowed && props.turnStatus === "inProgress"}
          block={block}
          key={block.key}
          turnKey={props.turnKey}
          {...(props.getTransferAccess === undefined
            ? {}
            : { getTransferAccess: props.getTransferAccess })}
          {...(props.onFixUnsupportedBlock === undefined
            ? {}
            : { onFixUnsupportedBlock: props.onFixUnsupportedBlock })}
        />
      ))}
    </View>
  );
}

function DisclosureActivitySegment(props: ActivitySegmentProps): ReactElement {
  const motionAllowed = useContext(TimelineMotionContext);
  const shouldAutoExpand = props.turnStatus === "inProgress" && !props.part.followedByAgent;
  const [expanded, setExpanded] = usePersistentExpansion(
    `${props.turnKey}:${props.part.key}`,
    false,
  );
  const visiblyExpanded = props.forceExpanded || shouldAutoExpand || expanded;
  const toggle = useEvent(() => {
    setExpanded((value) => !value);
  });
  return (
    <TurnActivity
      expanded={visiblyExpanded}
      forceExpandCards={props.forceExpanded}
      label={props.label}
      onToggle={toggle}
      outputFootprint={props.outputFootprint}
      showToggle={!shouldAutoExpand}
    >
      {props.part.blocks.map((block, index) => (
        <ActiveDisclosureBlock
          active={shouldAutoExpand && index === props.part.blocks.length - 1}
          animate={props.animateNew && motionAllowed && props.turnStatus === "inProgress"}
          block={block}
          key={block.key}
          turnKey={props.turnKey}
          {...(props.getTransferAccess === undefined
            ? {}
            : { getTransferAccess: props.getTransferAccess })}
          {...(props.onFixUnsupportedBlock === undefined
            ? {}
            : { onFixUnsupportedBlock: props.onFixUnsupportedBlock })}
        />
      ))}
    </TurnActivity>
  );
}

function ActiveDisclosureBlock(
  props: Parameters<typeof RevealedActivityBlock>[0] & { active: boolean },
): ReactElement {
  return (
    <ActiveToolCallContext.Provider value={props.active}>
      <RevealedActivityBlock {...props} />
    </ActiveToolCallContext.Provider>
  );
}

function RevealedActivityBlock({
  animate,
  block,
  getTransferAccess,
  onFixUnsupportedBlock,
  turnKey,
}: {
  animate: boolean;
  block: RenderBlock;
  getTransferAccess?: () => Promise<{ authorization: string; baseUrl: string }>;
  onFixUnsupportedBlock?: (block: RenderBlock) => Promise<void>;
  turnKey: string;
}): ReactElement {
  const content = (
    <NativeRevealSurface animate={animate} revealKey={`${turnKey}:${block.key}`}>
      <ProtocolBlock
        block={block}
        {...(getTransferAccess === undefined ? {} : { getTransferAccess })}
        {...(onFixUnsupportedBlock === undefined ? {} : { onFixUnsupportedBlock })}
      />
    </NativeRevealSurface>
  );
  return (
    <ExpansionItemKeyContext.Provider value={`${turnKey}:${block.key}`}>
      {content}
    </ExpansionItemKeyContext.Provider>
  );
}

function activitySegmentKind(
  blocks: readonly RenderBlock[],
): "agentNavigation" | "disclosure" | "thinking" {
  if (blocks.length > 0 && blocks.every((block) => block.kind === "reasoning")) {
    return "thinking";
  }
  if (
    blocks.length > 0 &&
    blocks.every(
      (block) => block.kind === "collabAgentToolCall" || block.kind === "subAgentActivity",
    )
  ) {
    return "agentNavigation";
  }
  return "disclosure";
}

export interface TurnActivityProps {
  children: React.ReactNode;
  compactHeader?: boolean;
  expanded: boolean;
  forceExpandCards?: boolean;
  label: string;
  loading?: boolean;
  onToggle: () => void;
  outputFootprint?: ActivityFootprint | null;
  showToggle?: boolean;
}

export function TurnActivity(props: TurnActivityProps): ReactElement {
  const compactHeader = props.compactHeader ?? false;
  return (
    <View
      style={[
        styles.turnActivity,
        compactHeader && styles.turnActivityCompact,
        props.expanded && styles.turnActivityExpanded,
      ]}
      testID="turn-activity"
    >
      {renderActivityToggle(props)}
      {renderExpandedActivity(props)}
    </View>
  );
}

function renderActivityToggle(props: TurnActivityProps): ReactElement | null {
  if (props.showToggle === false) {
    return null;
  }
  return (
    <TurnActivityToggle
      compactHeader={props.compactHeader ?? false}
      expanded={props.expanded}
      label={props.label}
      loading={props.loading ?? false}
      onToggle={props.onToggle}
      outputFootprint={props.outputFootprint ?? null}
    />
  );
}

function renderExpandedActivity(props: TurnActivityProps): ReactElement | null {
  if (!props.expanded) {
    return null;
  }
  return (
    <ExpandedActivityContent
      forceExpandCards={props.forceExpandCards ?? false}
      showToggle={props.showToggle ?? true}
    >
      {props.children}
    </ExpandedActivityContent>
  );
}

function TurnActivityToggle({
  compactHeader,
  expanded,
  label,
  loading,
  onToggle,
  outputFootprint,
}: {
  compactHeader: boolean;
  expanded: boolean;
  label: string;
  loading: boolean;
  onToggle: () => void;
  outputFootprint: ActivityFootprint | null;
}): ReactElement {
  const labelContent = loading ? (
    <WaveText
      containerStyle={styles.turnActivityLabelWave}
      style={styles.turnActivityLabel}
      testID="turn-activity-loading-shimmer"
      text={label}
    />
  ) : (
    <Text numberOfLines={1} style={styles.turnActivityLabel}>
      {label}
    </Text>
  );
  const chevron = expanded ? "chevron-up" : "chevron-down";
  return (
    <Pressable
      accessibilityLabel={`${expanded ? "Collapse" : "Expand"} activity ${label}`}
      accessibilityRole="button"
      hitSlop={10}
      onPress={onToggle}
      style={({ pressed }) => [
        styles.turnActivityToggle,
        compactHeader && styles.turnActivityToggleCompact,
        pressed && styles.pressed,
      ]}
    >
      <View style={styles.activityIconSlot}>
        <InlineIcon color={colors.textMuted} name="construct-outline" {...LABEL_ICON_PROPS} />
      </View>
      {labelContent}
      <OutputFootprintMetric footprint={outputFootprint} />
      <View style={styles.activityChevronSlot}>
        <InlineIcon color={colors.textDim} name={chevron} {...LABEL_ICON_PROPS} />
      </View>
    </Pressable>
  );
}

const LABEL_ICON_PROPS = { role: "label" } as const;

function ExpandedActivityContent({
  children,
  forceExpandCards,
  showToggle,
}: {
  children: React.ReactNode;
  forceExpandCards: boolean;
  showToggle: boolean;
}): ReactElement {
  const content = (
    <View
      style={[styles.turnActivityList, !showToggle && styles.turnActivityListWithoutToggle]}
      testID="turn-activity-list"
    >
      {children}
    </View>
  );
  const activity = (
    <TurnActivityContentContext.Provider value>{content}</TurnActivityContentContext.Provider>
  );
  return (
    <ForceExpandCardsContext.Provider value={forceExpandCards}>
      {activity}
    </ForceExpandCardsContext.Provider>
  );
}
