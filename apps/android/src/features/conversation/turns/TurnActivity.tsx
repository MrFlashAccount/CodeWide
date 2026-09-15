/** V1 TurnActivity owner, extracted without changing interaction or resource lifetime. */
import { type RenderBlock } from "@codewide/renderers";
import { type OutputFootprintProjection } from "@codewide/sync-client";
import { useContext } from "react";
import { Pressable, View } from "react-native";
import { activityOutputFootprint } from "../../../rendering/command-activity";
import { TimelineMotionContext } from "../../../rendering/FluidLayoutFrame";
import { NativeRevealSurface } from "../../../rendering/NativeRevealSurface";
import { type TurnSequencePart } from "../../../rendering/turn-sequence";
import { colors } from "../../../theme";
import { InlineIcon } from "../../../ui/InlineIcon";
import { AppText as Text } from "../../../ui/Typography";
import { WaveText } from "../../../ui/WaveText";
import { OutputFootprintMetric } from "../protocol/CommandOutput";
import { ProtocolBlock } from "../protocol/ProtocolBlock";
import { usePersistentExpansion } from "./Card";
import { styles } from "./TurnActivity.styles";
import {
  ActiveToolCallContext,
  ExpansionItemKeyContext,
  ForceExpandCardsContext,
  TurnActivityContentContext,
} from "./turnContexts";
import { turnActivityLabel } from "./turnProjection";

export function TurnActivitySegment({
  turnKey,
  part,
  turnStatus,
  animateNew,
  compact,
  forceExpanded,
  getTransferAccess,
  onFixUnsupportedBlock,
}: {
  turnKey: string;
  part: Extract<TurnSequencePart, { kind: "activity" }>;
  turnStatus: "completed" | "interrupted" | "failed" | "inProgress";
  animateNew: boolean;
  compact: boolean;
  forceExpanded: boolean;
  getTransferAccess?(): Promise<{ baseUrl: string; authorization: string }>;
  onFixUnsupportedBlock?(block: RenderBlock): Promise<void>;
}) {
  const motionAllowed = useContext(TimelineMotionContext);
  const thinkingOnly =
    part.blocks.length > 0 && part.blocks.every((block) => block.kind === "reasoning");
  const agentNavigationOnly =
    part.blocks.length > 0 &&
    part.blocks.every(
      (block) => block.kind === "collabAgentToolCall" || block.kind === "subAgentActivity",
    );
  const shouldAutoExpand = turnStatus === "inProgress" && !part.followedByAgent;
  const [expanded, setExpanded] = usePersistentExpansion(`${turnKey}:${part.key}`, false);
  const visiblyExpanded = forceExpanded || shouldAutoExpand || expanded;
  if (thinkingOnly) {
    return (
      <View testID="thinking-status-section" style={styles.thinkingStatusSection}>
        {part.blocks.map((block, index) => (
          <ActiveToolCallContext.Provider
            key={block.key}
            value={turnStatus === "inProgress" && index === part.blocks.length - 1}
          >
            <ProtocolBlock block={block} />
          </ActiveToolCallContext.Provider>
        ))}
      </View>
    );
  }
  if (agentNavigationOnly) {
    return (
      <View testID="subagent-activity-navigation" style={styles.turnActivityList}>
        {part.blocks.map((block) => (
          <ExpansionItemKeyContext.Provider key={block.key} value={`${turnKey}:${block.key}`}>
            <NativeRevealSurface
              revealKey={`${turnKey}:${block.key}`}
              animate={animateNew && motionAllowed && turnStatus === "inProgress"}
            >
              <ProtocolBlock
                block={block}
                {...(getTransferAccess === undefined ? {} : { getTransferAccess })}
                {...(onFixUnsupportedBlock === undefined ? {} : { onFixUnsupportedBlock })}
              />
            </NativeRevealSurface>
          </ExpansionItemKeyContext.Provider>
        ))}
      </View>
    );
  }
  return (
    <TurnActivity
      expanded={visiblyExpanded}
      forceExpandCards={forceExpanded}
      label={turnActivityLabel(
        part.blocks.map((block) => block.kind),
        compact,
      )}
      outputFootprint={activityOutputFootprint(
        part.blocks.flatMap((block) =>
          block.kind === "commandExecution" ? [{ raw: block.raw, visibleOutput: block.body }] : [],
        ),
      )}
      onToggle={() => setExpanded((value) => !value)}
      showToggle={!shouldAutoExpand}
    >
      {part.blocks.map((block, index) => (
        <ActiveToolCallContext.Provider
          key={block.key}
          value={shouldAutoExpand && index === part.blocks.length - 1}
        >
          <ExpansionItemKeyContext.Provider value={`${turnKey}:${block.key}`}>
            <NativeRevealSurface
              revealKey={`${turnKey}:${block.key}`}
              animate={animateNew && motionAllowed && turnStatus === "inProgress"}
            >
              <ProtocolBlock
                block={block}
                {...(getTransferAccess === undefined ? {} : { getTransferAccess })}
                {...(onFixUnsupportedBlock === undefined ? {} : { onFixUnsupportedBlock })}
              />
            </NativeRevealSurface>
          </ExpansionItemKeyContext.Provider>
        </ActiveToolCallContext.Provider>
      ))}
    </TurnActivity>
  );
}

export interface TurnActivityProps {
  children: React.ReactNode;
  compactHeader?: boolean;
  expanded: boolean;
  forceExpandCards?: boolean;
  label: string;
  loading?: boolean;
  onToggle(): void;
  outputFootprint?: OutputFootprintProjection | null;
  showToggle?: boolean;
}

export function TurnActivity(props: TurnActivityProps) {
  const {
    children,
    compactHeader = false,
    expanded,
    forceExpandCards = false,
    label,
    loading = false,
    onToggle,
    outputFootprint = null,
    showToggle = true,
  } = props;
  return (
    <View
      testID="turn-activity"
      style={[
        styles.turnActivity,
        compactHeader && styles.turnActivityCompact,
        expanded && styles.turnActivityExpanded,
      ]}
    >
      {showToggle && (
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={`${expanded ? "Collapse" : "Expand"} activity ${label}`}
          hitSlop={10}
          onPress={onToggle}
          style={({ pressed }) => [
            styles.turnActivityToggle,
            compactHeader && styles.turnActivityToggleCompact,
            pressed && styles.pressed,
          ]}
        >
          <View style={styles.activityIconSlot}>
            <InlineIcon name="construct-outline" role="label" color={colors.textMuted} />
          </View>
          {loading ? (
            <WaveText
              testID="turn-activity-loading-shimmer"
              text={label}
              style={styles.turnActivityLabel}
              containerStyle={styles.turnActivityLabelWave}
            />
          ) : (
            <Text numberOfLines={1} style={styles.turnActivityLabel}>
              {label}
            </Text>
          )}
          <OutputFootprintMetric footprint={outputFootprint} />
          <View style={styles.activityChevronSlot}>
            <InlineIcon
              name={expanded ? "chevron-up" : "chevron-down"}
              role="label"
              color={colors.textDim}
            />
          </View>
        </Pressable>
      )}
      {expanded && (
        <ForceExpandCardsContext.Provider value={forceExpandCards}>
          <TurnActivityContentContext.Provider value>
            <View
              testID="turn-activity-list"
              style={[styles.turnActivityList, !showToggle && styles.turnActivityListWithoutToggle]}
            >
              {children}
            </View>
          </TurnActivityContentContext.Provider>
        </ForceExpandCardsContext.Provider>
      )}
    </View>
  );
}
