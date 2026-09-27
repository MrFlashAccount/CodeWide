import type { ReactElement } from "react";
import { StyleSheet, View } from "react-native";
import { colors, controlSize, spacing, typeScale, typeWeight } from "../../../theme";
import { InlineIcon } from "../../../ui/InlineIcon";
import { AppText as Text } from "../../../ui/Typography";
import { WaveText } from "../../../ui/WaveText";

/** One geometry for the pending turn and its authoritative reasoning status. */
export function ThinkingStatus({
  running,
  testID = "thinking-status",
  text,
}: {
  running: boolean;
  testID?: string;
  text: string;
}): ReactElement {
  return (
    <View style={styles.row} testID={testID}>
      <View style={styles.iconSlot}>
        {/* WHY: InlineIcon consumes role as a typography token; it never forwards it as ARIA. */}
        {/* oxlint-disable-next-line react-doctor/aria-role */}
        <InlineIcon color={colors.textMuted} name="bulb-outline" role="label" />
      </View>
      {running ? (
        <WaveText containerStyle={styles.titleWave} style={styles.title} text={text} />
      ) : (
        <Text numberOfLines={1} style={styles.title}>
          {text}
        </Text>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  iconSlot: {
    alignItems: "center",
    flexShrink: 0,
    justifyContent: "center",
  },
  row: {
    alignItems: "center",
    flexDirection: "row",
    gap: spacing.compact,
    minHeight: controlSize.compact,
    minWidth: 0,
    paddingHorizontal: 0,
  },
  title: {
    color: colors.text,
    flexShrink: 1,
    minWidth: 0,
    ...typeScale.label,
    fontWeight: typeWeight.semibold,
  },
  titleWave: {
    alignSelf: "center",
    justifyContent: "center",
  },
});
