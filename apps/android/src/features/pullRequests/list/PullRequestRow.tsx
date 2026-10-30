import { Ionicons } from "@expo/vector-icons";
import { useSelector } from "@legendapp/state/react";
import { Pressable, View } from "react-native";

import type { ProviderIcon } from "../../../data/forgeProviderIcon";
import type { PullRequestRow as Row } from "../../../data/forgePullRequestContract";
import { displayedPullRequestAttention } from "../../../data/pullRequestAttention";
import { useEvent } from "../../../react/useEvent";
import { colors, iconSize } from "../../../theme";
import { CaptionBadge } from "../../../ui/CaptionBadge";
import { ForgeIcon } from "../../../ui/ForgeIcon";
import { compactAge } from "../../../ui/relativeAge";
import {
  CatalogRowBody,
  CatalogRowLeading,
  type CatalogRowMarker,
  CatalogRowMetaText,
  CatalogRowSubtitle,
  CatalogRowSubtitleLine,
  CatalogRowTitle,
  CatalogRowTitleLine,
  CatalogRowTrailing,
} from "../../../ui/CatalogRow";
import { catalogRowFrameStyles } from "../../../ui/CatalogRow.styles";
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

/** An undisplayed Companion attention revision uses the catalog's unread marker. */
const NEW_ACTIVITY_MARKERS: readonly CatalogRowMarker[] = [
  { kind: "unread", label: "New activity" },
];
const NO_MARKERS: readonly CatalogRowMarker[] = [];

/**
 * One PR in one read (Q1): check glyph, title, repo/number/author/you, at most
 * two badges, linked-thread count and age. Frame, typography and trailing meta
 * come from the shared catalog row, so it matches a Threads row.
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
      style={({ pressed }) => [
        catalogRowFrameStyles.frame,
        pressed && catalogRowFrameStyles.pressed,
      ]}
      testID={`pull-request-row-${row.number}`}
    >
      <CatalogRowBody>
        <TitleLine
          age={compactAge(row.updatedAt, nowMs)}
          glyph={glyph}
          icon={icon}
          markers={row.attention.state === "new" && !displayed ? NEW_ACTIVITY_MARKERS : NO_MARKERS}
          title={row.title}
        />
        <SubtitleLine row={row} />
      </CatalogRowBody>
    </Pressable>
  );
}

function TitleLine({
  age,
  glyph,
  icon,
  markers,
  title,
}: {
  readonly age: string;
  readonly glyph: CheckGlyph;
  readonly icon: ProviderIcon | null;
  readonly markers: readonly CatalogRowMarker[];
  readonly title: string;
}): React.JSX.Element {
  return (
    <CatalogRowTitleLine>
      <ProviderMark glyph={glyph} icon={icon} />
      <CatalogRowTitle running={false} value={title} />
      <CatalogRowTrailing age={age} markers={markers} />
    </CatalogRowTitleLine>
  );
}

function SubtitleLine({ row }: { readonly row: Row }): React.JSX.Element {
  return (
    <CatalogRowSubtitleLine>
      <CatalogRowSubtitle text={rowMeta(row)} />
      {rowBadges(row).map((badge) => (
        <CaptionBadge key={badge} label={badge} />
      ))}
      {row.linkedThreadCount > 0 ? <LinkedCount count={row.linkedThreadCount} /> : null}
    </CatalogRowSubtitleLine>
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
    <CatalogRowLeading>
      <View style={styles.rowLead}>
        <ForgeIcon icon={icon} size={iconSize.inline} />
        <View style={[styles.checkDot, DOT_STYLES[glyph.kind]]} />
      </View>
    </CatalogRowLeading>
  );
}

function LinkedCount({ count }: { readonly count: number }): React.JSX.Element {
  return (
    <View style={styles.linkedCount}>
      <Ionicons color={colors.textMuted} name="link-outline" size={iconSize.indicator} />
      <CatalogRowMetaText>{String(count)}</CatalogRowMetaText>
    </View>
  );
}
