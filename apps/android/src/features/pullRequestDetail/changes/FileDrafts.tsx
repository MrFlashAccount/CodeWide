import { useState } from "react";
import { Pressable, ScrollView, StyleSheet } from "react-native";

import type { DraftComment } from "../../../data/reviewDraftContract";
import { colors, controlSize, spacing, typeScale } from "../../../theme";
import { AppText as Text } from "../../../ui/Typography";
import { DraftCard } from "../../review/comments/DraftCard";

const DRAFT_LIST_MAX_HEIGHT = 220;

/**
 * Drafts of the selected file, folded to one line under its diff so the code
 * keeps the screen; the diff already shows them inline. Expanding lists each
 * draft with its per-axis badges and actions.
 */
export function FileDrafts({
  drafts,
  host,
  onDelete,
  onReanchor,
  onSendToAgent,
}: {
  readonly drafts: readonly DraftComment[];
  readonly host: string;
  readonly onDelete: (draft: DraftComment) => void;
  readonly onReanchor: (draft: DraftComment) => void;
  readonly onSendToAgent: (draft: DraftComment) => void;
}): React.JSX.Element | null {
  const [expanded, setExpanded] = useState(false);
  if (drafts.length === 0) {
    return null;
  }
  return (
    <>
      <Pressable
        accessibilityRole="button"
        accessibilityState={{ expanded }}
        onPress={() => {
          setExpanded(!expanded);
        }}
        style={styles.disclosure}
        testID="pr-file-drafts-toggle"
      >
        <Text style={styles.label}>
          {`${expanded ? "▾" : "▸"} ${String(drafts.length)} ${drafts.length === 1 ? "draft" : "drafts"} in this file`}
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
