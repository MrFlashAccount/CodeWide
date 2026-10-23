import { collapsedActivitySummary } from "../../../rendering/activityMetrics";
import type { CollapsedTurnActivityProps } from "./CollapsedTurnActivity.types";
import type { CompletedTurnHistoryProps } from "./CompletedTurnHistory.types";
/** V1 CompletedTurnHistory owner, extracted without changing interaction or resource lifetime. */
import { projectedActivityMetrics, type ActivityFootprint } from "@codewide/sync-client";
import { useRecyclingState } from "@legendapp/list/react-native";
import { useRef } from "react";
import { RichMarkdown } from "../../../rendering/RichMarkdown";
import { selectTurnRenderWindow } from "../../../rendering/thread-render-window";
import { chronologicalTurnSequence } from "../../../rendering/turn-sequence";
import { AppText as Text } from "../../../ui/Typography";
import { useEvent } from "../../../react/useEvent";
import { ActivityDetailSheet } from "./ActivityDetailSheet";
import { usePersistentExpansion } from "./Card";
import { hasCompletedTurnHistory } from "./completedHistoryVisibility";
import { styles } from "./CompletedTurnHistory.styles";
import { TurnActivity, TurnActivitySegment } from "./TurnActivity";
import { projectThreadItem, turnActivityLabel, turnMetadataBlocks } from "./turnProjection";

/**
 * A running turn's earlier actions: one row that opens the activity sheet, so
 * the live conversation does not grow while the agent works and no tool output
 * draws in the bubble.
 */
export function CollapsedTurnActivity(props: CollapsedTurnActivityProps) {
  return <SheetCollapsedTurnActivity {...props} />;
}

function SheetCollapsedTurnActivity(props: CollapsedTurnActivityProps) {
  const rawTurn = props.item.turn;
  const [sheetVisible, setSheetVisible] = useRecyclingState(false);
  const openSheet = useEvent(() => {
    setSheetVisible(true);
  });
  const closeSheet = useEvent(() => {
    setSheetVisible(false);
  });
  const activityKinds = props.indexes.flatMap((index) => {
    const rawItem = rawTurn.items[index];
    return rawItem === undefined ? [] : [rawItem.type];
  });
  const summary = collapsedActivitySummary(rawTurn, props.indexes);
  // Projected only while the sheet shows; the collapsed row needs just the summary.
  const blocks = sheetVisible
    ? props.indexes.flatMap((index) => {
        const rawItem = rawTurn.items[index];
        return rawItem === undefined ? [] : [projectThreadItem(props.item, rawItem, index)];
      })
    : [];
  return (
    <>
      <TurnActivity
        expanded={false}
        label={collapsedActivityLabel(summary, activityKinds, props.compact)}
        onToggle={openSheet}
        opensSheet
        outputFootprint={summary?.outputFootprint ?? null}
      >
        {null}
      </TurnActivity>
      <ActivityDetailSheet
        blocks={blocks}
        onClose={closeSheet}
        turnKey={props.item.key}
        turnStatus="inProgress"
        visible={sheetVisible}
        {...(props.getTransferAccess === undefined
          ? {}
          : { getTransferAccess: props.getTransferAccess })}
        {...(props.onFixUnsupportedBlock === undefined
          ? {}
          : { onFixUnsupportedBlock: props.onFixUnsupportedBlock })}
      />
    </>
  );
}

export function CompletedTurnHistory(props: CompletedTurnHistoryProps) {
  const rawTurn = props.item.turn;
  const [expanded, setExpanded] = usePersistentExpansion(
    `${props.item.key}:completed-history`,
    false,
  );
  const [loading, setLoading] = useRecyclingState(false);
  const [error, setError] = useRecyclingState<string | null>(null);
  // Keyed by turn: a recycled row may show another turn.
  const requestedTurnsRef = useRef(new Set<string>());
  // Thread search reveals the agent's own text, never tool output: it opens the
  // history, whose tool groups stay rows that open the activity sheet.
  const isExpanded = props.forceExpanded || expanded;
  const activitySummary = turnActivitySummary(props.item);
  const sequence = chronologicalTurnSequence(isExpanded ? expandedHistoryBlocks(props.item) : []);
  const load = () => {
    const onLoadItems = props.onLoadItems;
    if (
      onLoadItems === undefined ||
      rawTurn.itemsView === "full" ||
      requestedTurnsRef.current.has(rawTurn.id)
    ) {
      return;
    }
    requestedTurnsRef.current.add(rawTurn.id);
    setLoading(true);
    setError(null);
    onLoadItems(rawTurn.id)
      .catch((error: unknown) => {
        requestedTurnsRef.current.delete(rawTurn.id);
        setError(error instanceof Error ? error.message : "Could not load activity");
      })
      .finally(() => {
        setLoading(false);
      });
  };
  // An empty history is never drawn: nothing counted or recorded.
  if (!turnHasHistory(props.item)) {
    return null;
  }
  return (
    <TurnActivity
      compactHeader
      expanded={isExpanded}
      label={
        loading
          ? "Loading activity…"
          : error !== null
            ? "Activity unavailable"
            : turnActivityLabel(
                activitySummary?.kinds ?? [],
                props.compact,
                positiveCount(activitySummary?.count),
              )
      }
      loading={loading}
      onToggle={() => {
        const next = !isExpanded;
        setExpanded(next);
        if (next) {
          load();
        }
      }}
      outputFootprint={activitySummary?.outputFootprint ?? null}
    >
      {error !== null && <Text style={styles.agentPlaceholder}>{error}</Text>}
      {sequence.map((part) =>
        part.kind === "agent" ? (
          <RichMarkdown key={part.key} source={part.block.body ?? ""} />
        ) : (
          <TurnActivitySegment
            animateNew={false}
            compact={props.compact}
            key={part.key}
            part={part}
            turnKey={`${props.item.key}:completed-history`}
            turnStatus={rawTurn.status}
            {...(props.getTransferAccess === undefined
              ? {}
              : { getTransferAccess: props.getTransferAccess })}
            {...(props.onFixUnsupportedBlock === undefined
              ? {}
              : { onFixUnsupportedBlock: props.onFixUnsupportedBlock })}
          />
        ),
      )}
    </TurnActivity>
  );
}

type HistoryTurn = CompletedTurnHistoryProps["item"];

function turnHasHistory(turn: HistoryTurn): boolean {
  return hasCompletedTurnHistory(
    turn.turn,
    selectTurnRenderWindow(turn.turn).collapsedActivityIndexes,
  );
}

function expandedHistoryBlocks(turn: HistoryTurn): ReturnType<typeof projectThreadItem>[] {
  const rawTurn = turn.turn;
  if (rawTurn.itemsView !== "full") {
    return [];
  }
  const blocks = selectTurnRenderWindow(rawTurn).collapsedActivityIndexes.flatMap((index) => {
    const rawItem = rawTurn.items[index];
    return rawItem === undefined ? [] : [projectThreadItem(turn, rawItem, index)];
  });
  blocks.push(...turnMetadataBlocks(turn.key, rawTurn));
  return blocks;
}

type HistorySummary = {
  readonly count: number;
  readonly kinds: readonly string[];
  readonly outputFootprint: ActivityFootprint | null;
};

/**
 * The turn's Companion activity totals. Older Companions counted the work of
 * a turn without a user message as pre-turn lifecycle and reported no
 * activity for it; such a turn counts its own history items instead.
 */
function turnActivitySummary(turn: HistoryTurn): HistorySummary | null {
  const summary = projectedActivityMetrics(turn.turn)?.total;
  if (summary !== undefined && summary.count > 0) {
    return activitySummaryWithoutFooterDiff(summary);
  }
  const kinds = selectTurnRenderWindow(turn.turn).collapsedActivityIndexes.flatMap((index) => {
    const item = turn.turn.items[index];
    return item === undefined || item.type === "agentMessage" ? [] : [item.type];
  });
  if (kinds.length === 0) {
    return summary ?? null;
  }
  return { count: kinds.length, kinds, outputFootprint: summary?.outputFootprint ?? null };
}

/** Normalizes projections written before aggregate turn diffs became footer-owned. */
function activitySummaryWithoutFooterDiff(summary: ActivityFootprintSummary): HistorySummary {
  if (!summary.kinds.includes("turnDiff")) {
    return summary;
  }
  return {
    count: Math.max(0, summary.count - 1),
    kinds: summary.kinds.filter((kind) => kind !== "turnDiff"),
    outputFootprint: summary.outputFootprint,
  };
}

type ActivityFootprintSummary = NonNullable<ReturnType<typeof projectedActivityMetrics>>["total"];

function collapsedActivityLabel(
  summary: ReturnType<typeof collapsedActivitySummary>,
  fallbackKinds: readonly string[],
  compact: boolean,
): string {
  return turnActivityLabel(
    summary === null || summary.kinds.length === 0 ? fallbackKinds : summary.kinds,
    compact,
    positiveCount(summary?.count) ?? (fallbackKinds.length > 0 ? fallbackKinds.length : undefined),
  );
}

/** A count worth printing: a zero count is not shown as "· 0". */
function positiveCount(count: number | undefined): number | undefined {
  return count === undefined || count === 0 ? undefined : count;
}
