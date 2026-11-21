import { StyleSheet, View } from "react-native";

import type { GuideState } from "../../../data/reviewGuideContract";
import { colors, radii, spacing, typeScale, typeWeight } from "../../../theme";
import { AppText as Text } from "../../../ui/Typography";
import { stopProgress, type WalkStop } from "./guideWalk";
import { StripNav } from "./StripNav";

/** Thin progress segments, one per stop. */
const PROGRESS_SEGMENT_HEIGHT = 4;

const SEGMENT_STYLES = {
  accepted: { backgroundColor: colors.success },
  changed: { backgroundColor: colors.warning },
  commented: { backgroundColor: colors.textMuted },
  pending: { backgroundColor: colors.surfaceContainerHighest },
} as const;

/** `‹ 2 · Error mapping   Stop 3 of 9 ›` above a one-segment-per-stop progress bar. */
export function GuideStrip({
  current,
  onSelect,
  state,
  stops,
}: {
  readonly current: WalkStop;
  readonly onSelect: (index: number) => void;
  readonly state: GuideState;
  readonly stops: readonly WalkStop[];
}): React.JSX.Element {
  const accepted = stops.filter((entry) => stopProgress(state, entry.stop) === "accepted").length;
  return (
    <View
      accessibilityLabel={`Chapter ${String(current.chapterIndex + 1)}, ${current.chapter.title}. Stop ${String(current.index + 1)} of ${String(stops.length)}. ${String(accepted)} accepted.`}
      style={styles.strip}
      testID="review-guide-strip"
    >
      <StripHeader current={current} onSelect={onSelect} total={stops.length} />
      <View style={styles.bar}>
        {stops.map((entry) => (
          <View
            key={entry.stop.stopId}
            style={[
              styles.segment,
              SEGMENT_STYLES[stopProgress(state, entry.stop)],
              entry.index === current.index && styles.current,
            ]}
          />
        ))}
      </View>
    </View>
  );
}

function StripHeader({
  current,
  onSelect,
  total,
}: {
  readonly current: WalkStop;
  readonly onSelect: (index: number) => void;
  readonly total: number;
}): React.JSX.Element {
  return (
    <View style={styles.row}>
      <StripNav
        direction="back"
        enabled={current.index > 0}
        onPress={() => {
          onSelect(current.index - 1);
        }}
      />
      <Text ellipsizeMode="tail" numberOfLines={1} style={styles.chapter}>
        {`${String(current.chapterIndex + 1)} · ${current.chapter.title}`}
      </Text>
      <Text style={styles.position}>{`Stop ${String(current.index + 1)} of ${String(total)}`}</Text>
      <StripNav
        direction="forward"
        enabled={current.index + 1 < total}
        onPress={() => {
          onSelect(current.index + 1);
        }}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  bar: {
    columnGap: spacing.optical,
    flexDirection: "row",
  },
  chapter: {
    ...typeScale.body,
    color: colors.text,
    flex: 1,
    fontWeight: typeWeight.semibold,
  },
  current: {
    borderColor: colors.primary,
    borderWidth: 1,
  },
  position: {
    ...typeScale.label,
    color: colors.textMuted,
    fontVariant: ["tabular-nums"],
  },
  row: {
    alignItems: "center",
    columnGap: spacing.xs,
    flexDirection: "row",
  },
  segment: {
    borderRadius: radii.compact,
    flex: 1,
    height: PROGRESS_SEGMENT_HEIGHT,
  },
  strip: {
    gap: spacing.xs,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.xs,
  },
});
