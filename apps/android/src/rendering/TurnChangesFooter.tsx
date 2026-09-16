import { Ionicons } from "@expo/vector-icons";
import { useContext } from "react";
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
  const files = turnChangedFiles(props.diff);
  const open = useEvent(() => present?.(props.target, files));
  if (present === null || files.length === 0) {
    return null;
  }
  return (
    <Pressable
      accessibilityLabel="Changes in this turn"
      accessibilityRole="button"
      onPress={open}
      style={styles.trigger}
    >
      <Ionicons color={colors.textMuted} name="git-compare-outline" size={iconSize.indicator} />
      <Text numberOfLines={1} style={styles.caption}>
        Changes
      </Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  caption: {
    ...typeScale.caption,
    color: colors.textMuted,
  },
  trigger: {
    alignItems: "center",
    flexDirection: "row",
    flexShrink: 0,
    gap: spacing.xxs,
  },
});
