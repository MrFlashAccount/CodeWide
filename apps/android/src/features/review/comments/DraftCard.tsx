import { useRef } from "react";
import {
  Pressable,
  StyleSheet,
  View,
  type GestureResponderEvent,
  type Text as NativeText,
} from "react-native";

import type { DraftComment } from "../../../data/reviewDraftContract";
import { AppButton } from "../../../presentation/controls/AppButton";
import { colors, radii, spacing, typeScale } from "../../../theme";
import { ActionMenu } from "../../../ui/ActionMenu";
import { CaptionBadge } from "../../../ui/CaptionBadge";
import { TextShimmer } from "../../../ui/TextShimmer";
import { AppText as Text } from "../../../ui/Typography";
import { canSendToAgent, draftBadges, draftLocation, isOutdated, isReadOnly } from "./draftDisplay";

const DELETE_ACTIONS = [{ destructive: true, id: "delete", label: "Delete draft" }] as const;

/** Props of one draft card. */
export type DraftCardProps = {
  readonly draft: DraftComment;
  readonly host: string | null;
  readonly onDelete: (draft: DraftComment) => void;
  readonly onReanchor: ((draft: DraftComment) => void) | null;
  readonly onSendToAgent: ((draft: DraftComment) => void) | null;
  readonly sending: boolean;
};

/**
 * One companion-owned draft with a badge per active axis. A published draft is
 * read-only; an outdated one offers Re-anchor; an unsent agent half offers
 * Send to agent. Deleting is behind long-press.
 */
export function DraftCard(props: DraftCardProps): React.JSX.Element {
  if (isReadOnly(props.draft)) {
    return <DraftCardBody {...props} />;
  }
  return (
    <ActionMenu
      accessibilityLabel="Draft actions"
      actions={DELETE_ACTIONS}
      onSelect={() => {
        props.onDelete(props.draft);
      }}
      trigger="long-press"
    >
      <DraftCardBody {...props} />
    </ActionMenu>
  );
}

/** The card surface; ActionMenu injects its long-press trigger through `onLongPress`. */
function DraftCardBody(
  props: DraftCardProps & { readonly onLongPress?: (event: GestureResponderEvent) => void },
): React.JSX.Element {
  const { draft } = props;
  const body = useRef<NativeText>(null);
  const badges = draftBadges(draft, props.host);
  return (
    <Pressable
      accessibilityHint={isReadOnly(draft) ? undefined : "Long press to delete"}
      onLongPress={props.onLongPress}
      style={styles.card}
      testID={`review-draft-${draft.id}`}
    >
      <View style={styles.header}>
        <Text numberOfLines={1} style={styles.location}>
          {draftLocation(draft)}
        </Text>
        {badges.map((badge) => (
          <CaptionBadge key={badge.label} label={badge.label} tone={badge.tone} />
        ))}
      </View>
      <Text ref={body} selectable style={styles.body}>
        {draft.body}
      </Text>
      <TextShimmer
        shimmering={props.sending || badges.some((badge) => badge.shimmer)}
        target={body}
      />
      <DraftActions {...props} />
    </Pressable>
  );
}

function DraftActions({
  draft,
  onReanchor,
  onSendToAgent,
  sending,
}: DraftCardProps): React.JSX.Element {
  return (
    <View style={styles.actions}>
      {isOutdated(draft) && onReanchor !== null ? (
        <AppButton
          onPress={() => {
            onReanchor(draft);
          }}
          size="sm"
          variant="outline"
        >
          Re-anchor
        </AppButton>
      ) : null}
      {canSendToAgent(draft) && onSendToAgent !== null ? (
        <AppButton
          isDisabled={sending}
          onPress={() => {
            onSendToAgent(draft);
          }}
          size="sm"
          variant="secondary"
        >
          Send to agent
        </AppButton>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  actions: {
    columnGap: spacing.xs,
    flexDirection: "row",
    justifyContent: "flex-end",
  },
  body: {
    ...typeScale.body,
    color: colors.text,
  },
  card: {
    backgroundColor: colors.surfaceContainer,
    borderColor: colors.border,
    borderRadius: radii.medium,
    borderWidth: 1,
    gap: spacing.xs,
    padding: spacing.sm,
  },
  header: {
    alignItems: "center",
    columnGap: spacing.xxs,
    flexDirection: "row",
  },
  location: {
    ...typeScale.label,
    color: colors.textMuted,
    flex: 1,
  },
});
