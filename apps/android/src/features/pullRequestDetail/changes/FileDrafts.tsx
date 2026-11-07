import { useState } from "react";
import { Pressable, ScrollView, StyleSheet } from "react-native";

import type { DraftComment } from "../../../data/reviewDraftContract";
import type { DraftPut } from "../../../data/reviewDraftPuts";
import { colors, controlSize, spacing, typeScale } from "../../../theme";
import { AppText as Text } from "../../../ui/Typography";
import { DraftCard, DraftPutCard } from "../../review/comments/DraftCard";

const DRAFT_LIST_MAX_HEIGHT = 220;

/**
 * Drafts of the selected file, folded to one line under its diff so the code
 * keeps the screen; the diff already shows them inline. Expanding lists each
 * draft with its per-axis badges and actions, and the new drafts not saved
 * yet. A refused new draft unfolds the list until the user folds it, so its
 * reason and Edit are in view.
 */
export function FileDrafts({
  drafts,
  host,
  onDelete,
  onDiscardPut,
  onEditPut,
  onReanchor,
  onSendToAgent,
  puts,
}: {
  readonly drafts: readonly DraftComment[];
  readonly host: string;
  readonly onDelete: (draft: DraftComment) => void;
  readonly onDiscardPut: (put: DraftPut) => void;
  readonly onEditPut: (put: DraftPut) => void;
  readonly onReanchor: (draft: DraftComment) => void;
  readonly onSendToAgent: (draft: DraftComment) => void;
  readonly puts: readonly DraftPut[];
}): React.JSX.Element | null {
  // `null` follows the drafts: open while a new draft was refused.
  const [choice, setChoice] = useState<boolean | null>(null);
  const count = drafts.length + puts.length;
  if (count === 0) {
    return null;
  }
  const refused = puts.filter((put) => put.status === "failed").length;
  const expanded = choice ?? refused > 0;
  return (
    <>
      <Pressable
        accessibilityRole="button"
        accessibilityState={{ expanded }}
        onPress={() => {
          setChoice(!expanded);
        }}
        style={styles.disclosure}
        testID="pr-file-drafts-toggle"
      >
        <Text style={styles.label}>
          {`${expanded ? "▾" : "▸"} ${String(count)} ${count === 1 ? "draft" : "drafts"} in this file${refused === 0 ? "" : ` · ${String(refused)} not saved`}`}
        </Text>
      </Pressable>
      {expanded ? (
        <ScrollView contentContainerStyle={styles.drafts} style={styles.list}>
          {drafts.map((draft) => (
            <DraftCard
              draft={draft}
              host={host}
              key={draft.id}
              onDelete={onDelete}
              onReanchor={onReanchor}
              onSendToAgent={onSendToAgent}
              sending={false}
            />
          ))}
          {puts.map((put) => (
            <DraftPutCard
              key={put.draft.id}
              onDiscard={onDiscardPut}
              onEdit={onEditPut}
              put={put}
            />
          ))}
        </ScrollView>
      ) : null}
    </>
  );
}

const styles = StyleSheet.create({
  disclosure: {
    borderTopColor: colors.borderSoft,
    borderTopWidth: StyleSheet.hairlineWidth,
    height: controlSize.compact,
    justifyContent: "center",
    paddingHorizontal: spacing.sm,
  },
  drafts: {
    gap: spacing.xs,
    padding: spacing.sm,
  },
  label: {
    ...typeScale.label,
    color: colors.textMuted,
  },
  list: {
    flexGrow: 0,
    maxHeight: DRAFT_LIST_MAX_HEIGHT,
  },
});
