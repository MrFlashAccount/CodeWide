import { Ionicons } from "@expo/vector-icons";
import { useSelector } from "@legendapp/state/react";
import { Pressable, View } from "react-native";

import type { ProviderIcon } from "../../../data/forgeProviderIcon";
import type { PullRequestRow as Row } from "../../../data/forgePullRequestContract";
import type { ThreadUnreadReader } from "../../../data/project-unread-model";
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
const NEW_ACTIVITY: CatalogRowMarker = { kind: "unread", label: "New activity" };
/** An unread canonical review chat: the agent replied since the chat was last read. */
const AGENT_REPLIED: CatalogRowMarker = { kind: "agentReply", label: "Agent replied" };

/**
 * One PR in one read (Q1): check glyph, title, repo/number/author/you, at most
 * two badges, linked-thread count and age. Frame, typography and trailing meta
 * come from the shared catalog row, so it matches a Threads row.
 */
export function PullRequestRow({
  icon,
  isThreadUnread,
  nowMs,
  onPress,
  row,
}: {
  readonly icon: ProviderIcon | null;
  /** Unread state of the catalog's chats, read inside the row's selector. */
  readonly isThreadUnread: ThreadUnreadReader;
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
  const reviewThreadId = row.reviewThreadId;
  const agentReplied = useSelector(() => reviewThreadId !== null && isThreadUnread(reviewThreadId));
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
          markers={rowMarkers(row.attention.state === "new" && !displayed, agentReplied)}
          title={row.title}
        />
        <SubtitleLine row={row} />
      </CatalogRowBody>
    </Pressable>
  );
}

/** Forge activity and an agent reply are independent; both may show at once. */
function rowMarkers(newActivity: boolean, agentReplied: boolean): readonly CatalogRowMarker[] {
  if (newActivity) {
    return agentReplied ? [AGENT_REPLIED, NEW_ACTIVITY] : [NEW_ACTIVITY];
  }
  return agentReplied ? [AGENT_REPLIED] : [];
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
