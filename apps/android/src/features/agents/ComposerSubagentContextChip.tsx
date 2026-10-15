/** V1 ComposerSubagentContextChip owner, extracted without changing interaction or resource lifetime. */
import { Suspense } from "react";
import { Pressable } from "react-native";
import { SubagentListProjection, subagentsForThread } from "../../data/subagent-projection";
import type { ThreadSummaryDatabase } from "../../data/thread-summary-database";
import { useThreadSummaryView } from "../../data/use-thread-summary-view";
import { useConstant } from "../../react/useConstant";
import { colors } from "../../theme";
import { InlineIcon } from "../../ui/InlineIcon";
import { ComposerContextCount } from "../../ui/ResourceContextChip";
import { SUBAGENT_LIST_LIMIT } from "./agentSelection";
import { styles } from "./ComposerSubagentContextChip.styles";
import { WorkingSubagentsMenu, type SubagentOpener } from "./WorkingSubagentsMenu";

export function ComposerSubagentContextChip({
  connectionId,
  database,
  onOpen,
  parentThreadId,
}: {
  connectionId: string | null;
  database: ThreadSummaryDatabase | null;
  onOpen: SubagentOpener;
  parentThreadId: string | null;
}) {
  if (database === null || connectionId === null || parentThreadId === null) {
    return null;
  }
  return (
    <Suspense fallback={null}>
      <ComposerSubagentContextChipLoaded
        connectionId={connectionId}
        database={database}
        onOpen={onOpen}
        parentThreadId={parentThreadId}
      />
    </Suspense>
  );
}

export function ComposerSubagentContextChipLoaded({
  connectionId,
  database,
  onOpen,
  parentThreadId,
}: {
  connectionId: string;
  database: ThreadSummaryDatabase;
  onOpen: SubagentOpener;
  parentThreadId: string;
}) {
  const view = useThreadSummaryView(database, {
    archivedLimit: 0,
    connectionId: null,
    recentLimit: 0,
    selectedConnectionId: null,
    selectedThreadId: null,
    subagentConnectionId: connectionId,
    subagentLimit: SUBAGENT_LIST_LIMIT,
    viewId: `subagents:${connectionId}:${parentThreadId}`,
  });
  const projection = useConstant(() => new SubagentListProjection());
  const summaries = projection.project(view?.subagents ?? []);
  const visible = subagentsForThread(summaries, parentThreadId);
  if (visible.length === 0) {
    return null;
  }
  // The child thread's own status is the authority on who still works.
  const working = visible.filter((summary) => summary.status.type === "active");
  if (working.length > 0) {
    return (
      <WorkingSubagentsMenu
        onOpen={onOpen}
        summaries={summaries}
        total={visible.length}
        working={working}
      />
    );
  }
  return (
    <Pressable
      accessibilityLabel={`Subagents: ${String(visible.length)}`}
      accessibilityRole="button"
      onPress={() => {
        onOpen(summaries, null);
      }}
      style={styles.composerContextChip}
    >
      <InlineIcon color={colors.textMuted} name="people-outline" role="label" />
      <ComposerContextCount label="Subagents" value={visible.length} />
    </Pressable>
  );
}
