import { Ionicons } from "@expo/vector-icons";
import { useContext, useMemo } from "react";
import { Pressable, StyleSheet } from "react-native";

import { useEvent } from "../react/useEvent";
import { colors, iconSize, spacing, typeScale } from "../theme";
import { AppText as Text } from "../ui/Typography";
import { turnChangedFiles } from "./turn-changes";
import { TurnChangesContext, type TurnChangesTarget } from "./TurnChangesContext";

interface TurnChangesFooterProps {
  readonly diff: string;
  readonly target: TurnChangesTarget;
}

/** Opens the immutable patch from this turn, never Session or Last Turn. */
export function TurnChangesFooter(props: TurnChangesFooterProps) {
  const present = useContext(TurnChangesContext);
  const files = useMemo(() => turnChangedFiles(props.diff), [props.diff]);
  const open = useEvent(() => present?.(props.target, files));
  if (present === null || files.length === 0) return null;
  return <Pressable accessibilityRole="button" accessibilityLabel="Changes in this turn" onPress={open} style={styles.trigger}>
    <Ionicons name="git-compare-outline" size={iconSize.indicator} color={colors.textMuted} />
    <Text numberOfLines={1} style={styles.caption}>Changes</Text>
  </Pressable>;
}

const styles = StyleSheet.create({
  trigger: { flexDirection: "row", alignItems: "center", gap: spacing.xxs, flexShrink: 0 },
  caption: { ...typeScale.caption, color: colors.textMuted },
});
