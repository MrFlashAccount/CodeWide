import { blockActivitySummary } from "../../../rendering/activityMetrics";
/** V1 TurnActivity owner, extracted without changing interaction or resource lifetime. */
import type { RenderBlock } from "@codewide/renderers";
import type { ActivityFootprint } from "@codewide/sync-client";
import { useContext, useState, type ReactElement } from "react";
import { Pressable, View } from "react-native";
import { useInsideBubbleSurface } from "../../../rendering/Bubble";
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
import { ActivityDetailSheet } from "./ActivityDetailSheet";
import { styles } from "./TurnActivity.styles";
import {
  ActiveToolCallContext,
  TurnActivityMetricsContext,
  ExpansionItemKeyContext,
  TurnActivityContentContext,
} from "./turnContexts";
import { activitySegmentKind } from "./activitySegmentKind";
import { turnActivityLabel } from "./turnProjection";
import type { TransferAccess } from "../../../data/private-transfer";

export function TurnActivitySegment({
  animateNew,
  compact,
  getTransferAccess,
  onFixUnsupportedBlock,
  part,
  turnKey,
  turnStatus,
}: {
  animateNew: boolean;
  compact: boolean;
  getTransferAccess?: () => Promise<TransferAccess>;
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
    label,
    outputFootprint,
    part,
    turnKey,
    turnStatus,
    ...(getTransferAccess === undefined ? {} : { getTransferAccess }),
    ...(onFixUnsupportedBlock === undefined ? {} : { onFixUnsupportedBlock }),
  };
  return opensActivitySheet(insideActivity, part) ? (
    <SheetActivitySegment {...props} />
  ) : (
    <InlineActivitySegment {...props} />
  );
}

/**
 * Every group of tool calls opens the activity sheet, and so does any group
 * nested in another activity: a tool's output never draws in the bubble. Only
 * thinking and subagent navigation rows stay in place.
 */
function opensActivitySheet(
  insideActivity: boolean,
  part: Extract<TurnSequencePart, { kind: "activity" }>,
): boolean {
  return insideActivity || activitySegmentKind(part.blocks) === "disclosure";
}

type ActivitySegmentProps = {
  animateNew: boolean;
  getTransferAccess?: () => Promise<TransferAccess>;
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
        opensSheet
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

/** A group drawn in place: a thinking line or subagent navigation rows. */
function InlineActivitySegment(props: ActivitySegmentProps): ReactElement {
  return activitySegmentKind(props.part.blocks) === "thinking" ? (
    <ThinkingActivitySegment {...props} />
  ) : (
    <AgentNavigationActivitySegment {...props} />
  );
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
  const insideBubbleSurface = useInsideBubbleSurface();
  return (
    <View
      style={[styles.turnActivityList, insideBubbleSurface && styles.bubbleNestedActivityList]}
      testID="subagent-activity-navigation"
    >
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

function RevealedActivityBlock({
  animate,
  block,
  getTransferAccess,
  onFixUnsupportedBlock,
  turnKey,
}: {
  animate: boolean;
  block: RenderBlock;
  getTransferAccess?: () => Promise<TransferAccess>;
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

export interface TurnActivityProps {
  children: React.ReactNode;
  compactHeader?: boolean;
  expanded: boolean;
  label: string;
  loading?: boolean;
  onToggle: () => void;
  /** The row opens the activity sheet rather than disclosing its actions in place. */
  opensSheet?: boolean;
  outputFootprint?: ActivityFootprint | null;
  showToggle?: boolean;
}

export function TurnActivity(props: TurnActivityProps): ReactElement {
  const compactHeader = props.compactHeader ?? false;
  const insideBubbleSurface = useInsideBubbleSurface();
  return (
    <View
      style={[
        styles.turnActivity,
        insideBubbleSurface && styles.bubbleNestedActivity,
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
      opensSheet={props.opensSheet ?? false}
      outputFootprint={props.outputFootprint ?? null}
    />
  );
}

function renderExpandedActivity(props: TurnActivityProps): ReactElement | null {
  if (!props.expanded) {
    return null;
  }
  return (
    <ExpandedActivityContent showToggle={props.showToggle ?? true}>
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
  opensSheet,
  outputFootprint,
}: {
  compactHeader: boolean;
  expanded: boolean;
  label: string;
  loading: boolean;
  onToggle: () => void;
  opensSheet: boolean;
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
  const chevron = activityChevron(opensSheet, expanded);
  return (
    <Pressable
      accessibilityLabel={`${activityAction(opensSheet, expanded)} activity ${label}`}
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

function activityChevron(
  opensSheet: boolean,
  expanded: boolean,
): "chevron-forward" | "chevron-up" | "chevron-down" {
  if (opensSheet) {
    return "chevron-forward";
  }
  return expanded ? "chevron-up" : "chevron-down";
}

function activityAction(opensSheet: boolean, expanded: boolean): string {
  if (opensSheet) {
    return "Open";
  }
  return expanded ? "Collapse" : "Expand";
}

const LABEL_ICON_PROPS = { role: "label" } as const;

function ExpandedActivityContent({
  children,
  showToggle,
}: {
  children: React.ReactNode;
  showToggle: boolean;
}): ReactElement {
  const insideBubbleSurface = useInsideBubbleSurface();
  const content = (
    <View
      style={[
        styles.turnActivityList,
        insideBubbleSurface && styles.bubbleNestedActivityList,
        !showToggle && styles.turnActivityListWithoutToggle,
      ]}
      testID="turn-activity-list"
    >
      {children}
    </View>
  );
  return <TurnActivityContentContext.Provider value>{content}</TurnActivityContentContext.Provider>;
}
