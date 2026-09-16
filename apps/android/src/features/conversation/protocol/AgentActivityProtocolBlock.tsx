/** V1 AgentActivityProtocolBlock owner, extracted without changing interaction or resource lifetime. */
import type { RenderBlock } from "@codewide/renderers";
import { useContext } from "react";
import { Pressable, View } from "react-native";
import { subagentActivityTargetThreadId } from "../../../data/subagent-projection";
import { useInsideBubbleSurface } from "../../../rendering/Bubble";
import { colors, controlHitSlop } from "../../../theme";
import { InlineIcon } from "../../../ui/InlineIcon";
import { AppText as Text } from "../../../ui/Typography";
import { WaveText } from "../../../ui/WaveText";
import { SubagentNavigationContext } from "../turns/turnContexts";
import { styles } from "./AgentActivityProtocolBlock.styles";

export function AgentActivityProtocolBlock({ block }: { block: RenderBlock }) {
  const insideBubbleSurface = useInsideBubbleSurface();
  const openSubagent = useContext(SubagentNavigationContext);
  const targetThreadId = subagentActivityTargetThreadId(block.raw);
  const handlePress =
    targetThreadId === null || openSubagent === null
      ? undefined
      : () => {
          openSubagent(targetThreadId);
        };
  const canOpen = handlePress !== undefined;
  const path = typeof block.raw.agentPath === "string" ? block.raw.agentPath.trim() : "";
  const pathSegment = path.split("/").filter(Boolean).at(-1)?.replaceAll("_", " ") ?? "";
  const title = pathSegment !== "" ? pathSegment : block.title === "" ? "Subagent" : block.title;
  const activity = typeof block.raw.kind === "string" ? block.raw.kind : null;
  const activityLabel = activity === null ? "Subagent activity" : subagentActivityLabel(activity);
  const running = block.status === "inProgress" || block.status === "running";
  return (
    <View style={[styles.card, insideBubbleSurface && styles.bubbleNestedSurface]}>
      <View style={styles.cardHeader}>
        <Pressable
          testID="subagent-activity-link"
          {...(canOpen
            ? { accessibilityLabel: `Open subagent ${title}`, accessibilityRole: "button" as const }
            : {})}
          disabled={!canOpen}
          hitSlop={controlHitSlop.compact}
          onPress={handlePress}
          style={({ pressed }) => [styles.cardHeaderToggle, pressed && styles.pressed]}
        >
          <View style={styles.cardIconSlot}>
            <InlineIcon color={colors.textMuted} name="people-outline" role="label" />
          </View>
          {running ? (
            <WaveText containerStyle={styles.cardTitleWave} style={styles.cardTitle} text={title} />
          ) : (
            <Text numberOfLines={1} style={styles.cardTitle}>
              {title}
            </Text>
          )}
          <View style={styles.flex} />
          <Text numberOfLines={1} style={styles.agentActivityMeta}>
            {activityLabel}
          </Text>
          {block.status !== null && !running && (
            <View
              accessibilityLabel={`Status ${block.status}`}
              accessible
              style={styles.cardStatusIcon}
            >
              {block.status === "failed" || block.status === "error" ? (
                <InlineIcon color={colors.red} name="alert-circle" role="label" />
              ) : (
                <View style={styles.cardStatusDot} />
              )}
            </View>
          )}
          {canOpen && <InlineIcon color={colors.textDim} name="chevron-forward" role="label" />}
        </Pressable>
      </View>
    </View>
  );
}

export function subagentActivityLabel(value: string): string {
  const spaced = value
    .replaceAll(/([a-z0-9])([A-Z])/g, "$1 $2")
    .replaceAll("_", " ")
    .trim();
  return spaced === ""
    ? "Subagent activity"
    : `${spaced[0]?.toUpperCase() ?? ""}${spaced.slice(1)}`;
}
