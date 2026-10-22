import { Ionicons } from "@expo/vector-icons";
import { useRef, type RefObject } from "react";
import { Pressable, View, type Text as NativeText } from "react-native";

import type { PullRequestRow as Row } from "../../../data/forgePullRequestContract";
import { colors, iconSize } from "../../../theme";
import { CaptionBadge } from "../../../ui/CaptionBadge";
import { compactAge } from "../../../ui/relativeAge";
import { TextShimmer } from "../../../ui/TextShimmer";
import { AppText as Text } from "../../../ui/Typography";
import { listStyles as styles } from "./list.styles";
import {
  checkGlyph,
  rowAccessibilityLabel,
  rowBadges,
  rowMeta,
  type CheckGlyph,
} from "./pullRequestRowPresentation";

const DOT_STYLES = {
  failing: styles.dotFailing,
  neutral: styles.dotNeutral,
  passing: styles.dotPassing,
  pending: styles.dotPending,
} as const;

/**
 * One PR in one read (Q1): check glyph, title, repo/number/author/you, at most
 * two badges, linked-thread count and age. While its overview preloads the
 * title keeps its text and shimmers in place.
 */
export function PullRequestRow({
  nowMs,
  onPress,
  opening,
  row,
}: {
  readonly nowMs: number;
  readonly onPress: (row: Row) => void;
  readonly opening: boolean;
  readonly row: Row;
}): React.JSX.Element {
  const title = useRef<NativeText>(null);
  const glyph = checkGlyph(row.checks);
  return (
    <Pressable
      accessibilityLabel={rowAccessibilityLabel(row, glyph)}
      accessibilityRole="button"
      accessibilityState={{ busy: opening }}
      onPress={() => {
        onPress(row);
      }}
      style={({ pressed }) => [styles.row, pressed && styles.pressed]}
      testID={`pull-request-row-${row.number}`}
    >
      <CheckDot glyph={glyph} />
      <View style={styles.rowBody}>
        <TitleLine age={compactAge(row.updatedAt, nowMs)} title={row.title} titleRef={title} />
        <MetaLine row={row} />
      </View>
      <TextShimmer shimmering={opening} target={title} />
    </Pressable>
  );
}

function CheckDot({ glyph }: { readonly glyph: CheckGlyph }): React.JSX.Element {
  return (
    <View style={styles.rowLead}>
      <View style={[styles.dot, DOT_STYLES[glyph.kind]]} />
    </View>
  );
}

function TitleLine({
  age,
  title,
  titleRef,
}: {
  readonly age: string;
  readonly title: string;
  readonly titleRef: RefObject<NativeText | null>;
}): React.JSX.Element {
  return (
    <View style={styles.titleRow}>
      <Text
        ellipsizeMode="tail"
        numberOfLines={1}
        ref={titleRef}
        style={[styles.title, styles.titleFill]}
      >
        {title}
      </Text>
      <Text style={styles.age}>{age}</Text>
    </View>
  );
}

function MetaLine({ row }: { readonly row: Row }): React.JSX.Element {
  return (
    <View style={styles.metaRow}>
      <Text ellipsizeMode="tail" numberOfLines={1} style={styles.meta}>
        {rowMeta(row)}
      </Text>
      {rowBadges(row).map((badge) => (
        <CaptionBadge key={badge} label={badge} />
      ))}
      {row.linkedThreadCount > 0 ? <LinkedCount count={row.linkedThreadCount} /> : null}
    </View>
  );
}

function LinkedCount({ count }: { readonly count: number }): React.JSX.Element {
  return (
    <View style={styles.metaRow}>
      <Ionicons color={colors.textMuted} name="link-outline" size={iconSize.indicator} />
      <Text style={styles.meta}>{String(count)}</Text>
    </View>
  );
}
