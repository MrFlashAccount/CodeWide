/** Compact timeline row of an agent orchestration tool call, linking to the child agent. */
import { Ionicons } from "@expo/vector-icons";
import { useContext, type ReactElement } from "react";
import { Pressable, View } from "react-native";
import { useInsideBubbleSurface } from "../../../rendering/Bubble";
import { colors, controlHitSlop, iconSize } from "../../../theme";
import { AppText as Text } from "../../../ui/Typography";
import { WaveText } from "../../../ui/WaveText";
import { SubagentNavigationContext } from "../turns/turnContexts";
import type { OrchestrationToolCall } from "./orchestrationToolCall";
import { styles } from "./OrchestrationProtocolBlock.styles";

/** Renders `call`; the row opens the child agent through the subagent surface when it names one. */
export function OrchestrationProtocolBlock({
  call,
}: {
  readonly call: OrchestrationToolCall;
}): ReactElement {
  const insideBubbleSurface = useInsideBubbleSurface();
  const openSubagent = useContext(SubagentNavigationContext);
  const targetThreadId = call.targetThreadId;
  const open =
    targetThreadId === null || openSubagent === null
      ? null
      : () => {
          openSubagent(targetThreadId);
        };
  return (
    <View
      style={[styles.card, insideBubbleSurface && styles.bubbleNestedSurface]}
      testID="orchestration-tool-call"
    >
      <OrchestrationHeader call={call} open={open} />
      {call.detail !== null && (
        <Text numberOfLines={3} style={styles.detail}>
          {call.detail}
        </Text>
      )}
    </View>
  );
}

function OrchestrationHeader({
  call,
  open,
}: {
  readonly call: OrchestrationToolCall;
  readonly open: (() => void) | null;
}): ReactElement {
  return (
    <Pressable
      {...(open === null
        ? {}
        : {
            accessibilityLabel: `${call.title}. Open agent`,
            accessibilityRole: "button" as const,
          })}
      disabled={open === null}
      hitSlop={controlHitSlop.compact}
      onPress={open ?? undefined}
      style={({ pressed }) => [styles.header, pressed && styles.pressed]}
    >
      <Ionicons
        color={call.failed ? colors.red : colors.textMuted}
        name={call.failed ? "alert-circle" : "people-outline"}
        size={iconSize.inline}
      />
      <OrchestrationTitle running={call.running} title={call.title} />
      <View style={styles.flex} />
      {call.meta !== null && (
        <Text numberOfLines={1} style={styles.meta}>
          {call.meta}
        </Text>
      )}
      {open !== null && (
        <Ionicons color={colors.textDim} name="chevron-forward" size={iconSize.inline} />
      )}
    </Pressable>
  );
}

function OrchestrationTitle({
  running,
  title,
}: {
  readonly running: boolean;
  readonly title: string;
}): ReactElement {
  return running ? (
    <WaveText containerStyle={styles.titleWave} style={styles.title} text={title} />
  ) : (
    <Text numberOfLines={1} style={styles.title}>
      {title}
    </Text>
  );
}
