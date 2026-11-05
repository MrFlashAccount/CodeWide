import { useRef } from "react";
import {
  Pressable,
  StyleSheet,
  View,
  type GestureResponderEvent,
  type Text as NativeText,
} from "react-native";

import type { DraftComment } from "../../../data/reviewDraftContract";
import type { DraftPut } from "../../../data/reviewDraftPuts";
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

const PUT_DESTINATION_LABELS: Readonly<Record<DraftPut["draft"]["destination"], string>> = {
  agent: "Agent",
  both: "PR · Agent",
  pr: "PR",
};

/** Props of a draft the companion has not saved yet. */
export type DraftPutCardProps = {
  readonly onDiscard: (put: DraftPut) => void;
  /** Restores the refused text into the line composer. */
  readonly onEdit: (put: DraftPut) => void;
  readonly put: DraftPut;
};

/**
 * A new draft as soon as it is sent: its text shimmers in place while the
 * companion saves it. A refused draft stops shimmering, shows the companion's
 * reason, and offers Edit (the text returns to the composer at its line) and
 * Discard.
 */
export function DraftPutCard({ onDiscard, onEdit, put }: DraftPutCardProps): React.JSX.Element {
  const body = useRef<NativeText>(null);
  const { anchor } = put.draft;
  return (
    <View style={styles.card} testID={`review-draft-put-${put.draft.id}`}>
      <View style={styles.header}>
        <Text numberOfLines={1} style={styles.location}>
          {`You · line ${String(anchor.startLine)}`}
        </Text>
        {put.status === "failed" ? (
          <CaptionBadge label="Not saved" tone="danger" />
        ) : (
          <CaptionBadge label={PUT_DESTINATION_LABELS[put.draft.destination]} tone="neutral" />
        )}
      </View>
      <Text
        accessibilityState={{ busy: put.status === "saving" }}
        ref={body}
        selectable
        style={styles.body}
      >
        {put.draft.body}
      </Text>
      <TextShimmer shimmering={put.status === "saving"} target={body} />
      {put.status === "failed" ? (
        <Text accessibilityLiveRegion="polite" style={styles.error}>
          {put.error}
        </Text>
      ) : null}
      {put.status === "failed" ? (
        <PutFailureActions onDiscard={onDiscard} onEdit={onEdit} put={put} />
      ) : null}
    </View>
  );
}

function PutFailureActions({ onDiscard, onEdit, put }: DraftPutCardProps): React.JSX.Element {
  return (
    <View style={styles.actions}>
      <AppButton
        onPress={() => {
          onDiscard(put);
        }}
        size="sm"
        variant="outline"
      >
        Discard
      </AppButton>
      <AppButton
        onPress={() => {
          onEdit(put);
        }}
        size="sm"
        variant="secondary"
      >
        Edit
      </AppButton>
    </View>
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
  error: {
    ...typeScale.label,
    color: colors.error,
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
