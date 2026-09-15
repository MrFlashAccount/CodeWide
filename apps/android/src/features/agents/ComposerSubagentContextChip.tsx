/** V1 ComposerSubagentContextChip owner, extracted without changing interaction or resource lifetime. */
import { Suspense, useState } from "react";
import { Pressable } from "react-native";
import { SubagentListProjection, subagentsForThread } from "../../data/subagent-projection";
import type { ThreadSummaryDatabase } from "../../data/thread-summary-database";
import type { StoredThreadSummary } from "../../data/thread-summary-types";
import { useThreadSummaryView } from "../../data/use-thread-summary-view";
import { colors } from "../../theme";
import { InlineIcon } from "../../ui/InlineIcon";
import { ComposerContextCount } from "../../ui/ResourceContextChip";
import { SUBAGENT_LIST_LIMIT } from "./agentSelection";
import { styles } from "./ComposerSubagentContextChip.styles";

export function ComposerSubagentContextChip({
  database,
  connectionId,
  parentThreadId,
  onOpen,
}: {
  database: ThreadSummaryDatabase | null;
  connectionId: string | null;
  parentThreadId: string | null;
  onOpen(summaries: readonly StoredThreadSummary[]): void;
}) {
  if (database === null || connectionId === null || parentThreadId === null) return null;
  return (
    <Suspense fallback={null}>
      <ComposerSubagentContextChipLoaded
        database={database}
        connectionId={connectionId}
        parentThreadId={parentThreadId}
        onOpen={onOpen}
      />
    </Suspense>
  );
}

export function ComposerSubagentContextChipLoaded({
  database,
  connectionId,
  parentThreadId,
  onOpen,
}: {
  database: ThreadSummaryDatabase;
  connectionId: string;
  parentThreadId: string;
  onOpen(summaries: readonly StoredThreadSummary[]): void;
}) {
  const view = useThreadSummaryView(database, {
    viewId: `subagents:${connectionId}:${parentThreadId}`,
    connectionId: null,
    recentLimit: 0,
    archivedLimit: 0,
    selectedConnectionId: null,
    selectedThreadId: null,
    subagentConnectionId: connectionId,
    subagentLimit: SUBAGENT_LIST_LIMIT,
  });
  const [projection] = useState(() => new SubagentListProjection());
  const summaries = projection.project(view?.subagents ?? []);
  const visible = subagentsForThread(summaries, parentThreadId);
  if (visible.length === 0) return null;
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={`Subagents: ${visible.length}`}
      onPress={() => onOpen(summaries)}
      style={styles.composerContextChip}
    >
      <InlineIcon
        name="people-outline"
        role="label"
        color={
          visible.some((summary) => summary.status.type === "active")
            ? colors.green
            : colors.textMuted
        }
      />
      <ComposerContextCount label="Subagents" value={visible.length} />
    </Pressable>
  );
}
