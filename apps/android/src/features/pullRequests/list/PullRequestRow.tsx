import { Ionicons } from "@expo/vector-icons";
import { useSelector } from "@legendapp/state/react";
import { Pressable, View } from "react-native";

import type { ProviderIcon } from "../../../data/forgeContract";
import type { PullRequestRow as Row } from "../../../data/forgePullRequestContract";
import { displayedPullRequestAttention } from "../../../data/pullRequestAttention";
import { useEvent } from "../../../react/useEvent";
import { colors, iconSize } from "../../../theme";
import { CaptionBadge } from "../../../ui/CaptionBadge";
import { ForgeIcon } from "../../../ui/ForgeIcon";
import { compactAge } from "../../../ui/relativeAge";
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
 * two badges, linked-thread count and age.
 */
export function PullRequestRow({
  icon,
  nowMs,
  onPress,
  row,
}: {
  readonly icon: ProviderIcon | null;
  readonly nowMs: number;
  readonly onPress: (row: Row) => void;
  readonly row: Row;
}): React.JSX.Element {
  const glyph = checkGlyph(row.checks);
  const attentionRevision = row.attention.state === "unsupported" ? null : row.attention.revision;
  const displayed = useSelector(
    () =>
      attentionRevision !== null &&
      displayedPullRequestAttention[row.pullRequest]?.get() === attentionRevision,
  );
  const handlePress = useEvent((): void => {
    onPress(row);
  });
  return (
    <Pressable
      accessibilityLabel={rowAccessibilityLabel(row, glyph)}
      accessibilityRole="button"
      onPress={handlePress}
      style={({ pressed }) => [styles.row, pressed && styles.pressed]}
      testID={`pull-request-row-${row.number}`}
    >
      <ProviderMark glyph={glyph} icon={icon} />
      <View style={styles.rowBody}>
        <TitleLine
          age={compactAge(row.updatedAt, nowMs)}
          attention={row.attention.state === "new" && !displayed}
          title={row.title}
        />
        <MetaLine row={row} />
      </View>
    </Pressable>
  );
}

function ProviderMark({
  glyph,
  icon,
}: {
  readonly glyph: CheckGlyph;
  readonly icon: ProviderIcon | null;
}): React.JSX.Element {
  return (
    <View style={styles.rowLead}>
      <ForgeIcon glyph={icon?.glyph ?? null} iconKey={icon?.iconKey ?? ""} size={iconSize.inline} />
      <View style={[styles.checkDot, DOT_STYLES[glyph.kind]]} />
    </View>
  );
}

function TitleLine({
  age,
  attention,
  title,
}: {
  readonly age: string;
  readonly attention: boolean;
  readonly title: string;
}): React.JSX.Element {
  return (
    <View style={styles.titleRow}>
      {attention ? <View style={styles.attentionDot} /> : null}
      <Text ellipsizeMode="tail" numberOfLines={1} style={[styles.title, styles.titleFill]}>
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
