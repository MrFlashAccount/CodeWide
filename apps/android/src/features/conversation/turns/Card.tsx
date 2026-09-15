/** V1 Card owner, extracted without changing interaction or resource lifetime. */
import { Ionicons } from "@expo/vector-icons";
import { useContext, useState, type ReactNode } from "react";
import { Pressable, View } from "react-native";
import { useInsideBubbleSurface } from "../../../rendering/Bubble";
import { colors } from "../../../theme";
import { InlineIcon } from "../../../ui/InlineIcon";
import { AppText as Text } from "../../../ui/Typography";
import { WaveText } from "../../../ui/WaveText";
import { styles } from "./Card.styles";
import { CopyButton } from "./MessageActionRail";
import { persistentExpansionStates, writePersistentExpansionState } from "./disclosureState";
import {
  ActiveToolCallContext,
  ExpansionItemKeyContext,
  ForceExpandCardsContext,
} from "./turnContexts";

export function Card({
  title,
  icon,
  status,
  headerMeta,
  copyText,
  collapsible = false,
  initiallyExpanded = true,
  children,
}: {
  title: string;
  icon: keyof typeof Ionicons.glyphMap;
  status?: string;
  headerMeta?: ReactNode;
  copyText?: () => string;
  collapsible?: boolean;
  initiallyExpanded?: boolean;
  children: ReactNode;
}) {
  const insideBubbleSurface = useInsideBubbleSurface();
  const itemKey = useContext(ExpansionItemKeyContext);
  const [expanded, setExpanded] = usePersistentExpansion(`${itemKey}:card`, initiallyExpanded);
  const forceExpanded = useContext(ForceExpandCardsContext);
  const activeToolCall = useContext(ActiveToolCallContext);
  const isRunning = status === "inProgress" || status === "running" || activeToolCall;
  const visiblyExpanded = forceExpanded || expanded;
  return (
    <View
      testID="protocol-card"
      collapsable={false}
      style={[styles.card, insideBubbleSurface && styles.bubbleNestedSurface]}
    >
      <View testID="protocol-card-header" collapsable={false} style={styles.cardHeader}>
        <Pressable
          accessibilityRole={collapsible ? "button" : undefined}
          accessibilityLabel={
            collapsible ? `${visiblyExpanded ? "Collapse" : "Expand"} ${title}` : undefined
          }
          disabled={!collapsible}
          hitSlop={collapsible ? 10 : undefined}
          onPress={() => setExpanded(!visiblyExpanded)}
          style={styles.cardHeaderToggle}
        >
          <View testID="protocol-card-icon" style={styles.cardIconSlot}>
            <InlineIcon name={icon} role="label" color={colors.textMuted} />
          </View>
          {isRunning ? (
            <WaveText
              key="running-title"
              text={title}
              style={styles.cardTitle}
              containerStyle={styles.cardTitleWave}
            />
          ) : (
            <Text key="settled-title" numberOfLines={1} style={styles.cardTitle}>
              {title}
            </Text>
          )}
          <View style={styles.flex} />
          {headerMeta}
          {status && !isRunning && (
            <View accessible accessibilityLabel={`Status ${status}`} style={styles.cardStatusIcon}>
              {status === "failed" || status === "error" ? (
                <InlineIcon name="alert-circle" role="label" color={colors.red} />
              ) : (
                <View style={styles.cardStatusDot} />
              )}
            </View>
          )}
          {collapsible && (
            <InlineIcon
              name={visiblyExpanded ? "chevron-up" : "chevron-down"}
              role="label"
              color={colors.textDim}
            />
          )}
        </Pressable>
        {copyText !== undefined && !collapsible && <CopyButton getText={copyText} />}
      </View>
      {(!collapsible || visiblyExpanded) && <View style={styles.cardContent}>{children}</View>}
    </View>
  );
}

export function usePersistentExpansion(
  localKey: string,
  initialValue: boolean,
): [boolean, (value: boolean | ((current: boolean) => boolean)) => void] {
  // ExpansionItemKey already includes the connection/thread/turn identity.
  // The bounded external cache survives LegendList recycling without a broad
  // React context update whenever an unrelated live turn changes.
  const [value, setValueState] = useState(
    () => persistentExpansionStates.get(localKey) ?? initialValue,
  );
  const setValue = (next: boolean | ((current: boolean) => boolean)) => {
    setValueState((current) => {
      const resolved = typeof next === "function" ? next(current) : next;
      writePersistentExpansionState(localKey, resolved);
      return resolved;
    });
  };
  return [value, setValue];
}
