import { ScrollView, StyleSheet } from "react-native";

import type { DraftComment } from "../../../data/reviewDraftContract";
import { spacing } from "../../../theme";
import { DraftCard } from "../../review/comments/DraftCard";

const DRAFT_LIST_MAX_HEIGHT = 220;

/** Drafts of the selected file under its diff, each with its per-axis badges. */
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
  if (drafts.length === 0) {
    return null;
  }
  return (
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
  );
}

const styles = StyleSheet.create({
  drafts: {
    gap: spacing.xs,
    padding: spacing.sm,
  },
  list: {
    flexGrow: 0,
    maxHeight: DRAFT_LIST_MAX_HEIGHT,
  },
});
