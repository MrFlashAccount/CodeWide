/** V1 AgentActivityProtocolBlock owner, extracted without changing interaction or resource lifetime. */
import type { Thread } from "@codewide/codex-protocol/v0.147.0/v2";
import { type RenderBlock } from "@codewide/renderers";
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
  // WHY: RenderBlock erases the protocol item union after renderer normalization. The V1
  // renderer already relied on this protocol-item assertion, and no discriminator-preserving
  // RenderBlock type is available at this boundary.
  const protocolItem = block.raw as Thread["turns"][number]["items"][number];
  const targetThreadId = subagentActivityTargetThreadId(protocolItem);
  const handlePress =
    targetThreadId === null || openSubagent === null
      ? undefined
      : () => openSubagent(targetThreadId);
  const canOpen = handlePress !== undefined;
  const path = typeof block.raw.agentPath === "string" ? block.raw.agentPath.trim() : "";
  const pathSegment = path.split("/").filter(Boolean).at(-1)?.replaceAll("_", " ") ?? "";
  const title = pathSegment || block.title || "Subagent";
  const activity = typeof block.raw.kind === "string" ? block.raw.kind : null;
  const activityLabel = activity === null ? "Subagent activity" : subagentActivityLabel(activity);
  const running = block.status === "inProgress" || block.status === "running";
  return (
    <View style={[styles.card, insideBubbleSurface && styles.bubbleNestedSurface]}>
      <View style={styles.cardHeader}>
        <Pressable
          testID="subagent-activity-link"
          {...(canOpen
            ? { accessibilityRole: "button" as const, accessibilityLabel: `Open subagent ${title}` }
            : {})}
          disabled={!canOpen}
          onPress={handlePress}
          hitSlop={controlHitSlop.compact}
          style={({ pressed }) => [styles.cardHeaderToggle, pressed && styles.pressed]}
        >
          <View style={styles.cardIconSlot}>
            <InlineIcon name="people-outline" role="label" color={colors.textMuted} />
          </View>
          {running ? (
            <WaveText text={title} style={styles.cardTitle} containerStyle={styles.cardTitleWave} />
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
              accessible
              accessibilityLabel={`Status ${block.status}`}
              style={styles.cardStatusIcon}
            >
              {block.status === "failed" || block.status === "error" ? (
                <InlineIcon name="alert-circle" role="label" color={colors.red} />
              ) : (
                <View style={styles.cardStatusDot} />
              )}
            </View>
          )}
          {canOpen && <InlineIcon name="chevron-forward" role="label" color={colors.textDim} />}
        </Pressable>
      </View>
    </View>
  );
}

export function subagentActivityLabel(value: string): string {
  const spaced = value
    .replace(/([a-z0-9])([A-Z])/g, "$1 $2")
    .replaceAll("_", " ")
    .trim();
  return spaced === ""
    ? "Subagent activity"
    : `${spaced[0]?.toUpperCase() ?? ""}${spaced.slice(1)}`;
}
