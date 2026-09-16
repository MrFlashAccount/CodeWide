/** V1 Card owner, extracted without changing interaction or resource lifetime. */
import type { Ionicons } from "@expo/vector-icons";
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
  children,
  collapsible = false,
  copyText,
  headerMeta,
  icon,
  initiallyExpanded = true,
  status,
  title,
}: {
  children: ReactNode;
  collapsible?: boolean;
  copyText?: () => string;
  headerMeta?: ReactNode;
  icon: keyof typeof Ionicons.glyphMap;
  initiallyExpanded?: boolean;
  status?: string;
  title: string;
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
      collapsable={false}
      style={[styles.card, insideBubbleSurface && styles.bubbleNestedSurface]}
      testID="protocol-card"
    >
      <View collapsable={false} style={styles.cardHeader} testID="protocol-card-header">
        <Pressable
          accessibilityLabel={
            collapsible ? `${visiblyExpanded ? "Collapse" : "Expand"} ${title}` : undefined
          }
          accessibilityRole={collapsible ? "button" : undefined}
          disabled={!collapsible}
          hitSlop={collapsible ? 10 : undefined}
          onPress={() => {
            setExpanded(!visiblyExpanded);
          }}
          style={styles.cardHeaderToggle}
        >
          <View style={styles.cardIconSlot} testID="protocol-card-icon">
            <InlineIcon color={colors.textMuted} name={icon} role="label" />
          </View>
          {isRunning ? (
            <WaveText
              containerStyle={styles.cardTitleWave}
              key="running-title"
              style={styles.cardTitle}
              text={title}
            />
          ) : (
            <Text key="settled-title" numberOfLines={1} style={styles.cardTitle}>
              {title}
            </Text>
          )}
          <View style={styles.flex} />
          {headerMeta}
          {typeof status === "string" && status !== "" && !isRunning && (
            <View accessibilityLabel={`Status ${status}`} accessible style={styles.cardStatusIcon}>
              {status === "failed" || status === "error" ? (
                <InlineIcon color={colors.red} name="alert-circle" role="label" />
              ) : (
                <View style={styles.cardStatusDot} />
              )}
            </View>
          )}
          {collapsible && (
            <InlineIcon
              color={colors.textDim}
              name={visiblyExpanded ? "chevron-up" : "chevron-down"}
              role="label"
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
  const [value, setValue] = useState(() => persistentExpansionStates.get(localKey) ?? initialValue);
  const persistValue = (next: boolean | ((current: boolean) => boolean)) => {
    setValue((current) => {
      const resolved = typeof next === "function" ? next(current) : next;
      writePersistentExpansionState(localKey, resolved);
      return resolved;
    });
  };
  return [value, persistValue];
}
