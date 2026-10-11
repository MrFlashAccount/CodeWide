import { collapsedActivitySummary } from "../../../rendering/activityMetrics";
import type { CollapsedTurnActivityProps } from "./CollapsedTurnActivity.types";
import type { CompletedTurnHistoryProps } from "./CompletedTurnHistory.types";
/** V1 CompletedTurnHistory owner, extracted without changing interaction or resource lifetime. */
import { projectedActivityMetrics, type ActivityFootprint } from "@codewide/sync-client";
import { useRecyclingState } from "@legendapp/list/react-native";
import { useRef } from "react";
import { Pressable } from "react-native";
import { RichMarkdown } from "../../../rendering/RichMarkdown";
import { selectTurnRenderWindow } from "../../../rendering/thread-render-window";
import { chronologicalTurnSequence } from "../../../rendering/turn-sequence";
import { AppText as Text } from "../../../ui/Typography";
import { ProtocolBlock } from "../protocol/ProtocolBlock";
import { usePersistentExpansion } from "./Card";
import { foldsAnswerIntoHistory } from "./turnBubbleGroup";
import { hasCompletedTurnHistory } from "./completedHistoryVisibility";
import { styles } from "./CompletedTurnHistory.styles";
import { TurnActivity, TurnActivitySegment } from "./TurnActivity";
import { ExpansionItemKeyContext } from "./turnContexts";
import { projectThreadItem, turnActivityLabel, turnMetadataBlocks } from "./turnProjection";

export function CollapsedTurnActivity(props: CollapsedTurnActivityProps) {
  const rawTurn = props.item.turn;
  const [expanded, setExpanded] = usePersistentExpansion(
    `${props.item.key}:prior-activity:${String(props.indexes[0] ?? "empty")}`,
    false,
  );
  const [visibleBlockCount, setVisibleBlockCount] = useRecyclingState(16);
  const isExpanded = props.forceExpanded || expanded;
  const activityKinds = props.indexes.flatMap((index) => {
    const rawItem = rawTurn.items[index];
    return rawItem === undefined ? [] : [rawItem.type];
  });
  const blocks = !isExpanded
    ? []
    : props.indexes.slice(0, visibleBlockCount).flatMap((index) => {
        const rawItem = rawTurn.items[index];
        return rawItem === undefined ? [] : [projectThreadItem(props.item, rawItem, index)];
      });
  const summary = collapsedActivitySummary(rawTurn, props.indexes);
  const outputFootprint = summary?.outputFootprint ?? null;

  return (
    <TurnActivity
      expanded={isExpanded}
      forceExpandCards={props.forceExpanded}
      label={collapsedActivityLabel(summary, activityKinds, props.compact)}
      onToggle={() => {
        setExpanded(!isExpanded);
      }}
      outputFootprint={outputFootprint}
    >
      {blocks.map((block) =>
        block.kind === "agentMessage" ? (
          <RichMarkdown key={block.key} source={block.body ?? ""} />
        ) : (
          <ExpansionItemKeyContext.Provider
            key={block.key}
            value={`${props.item.key}:${block.key}`}
          >
            <ProtocolBlock
              block={block}
              {...(props.getTransferAccess === undefined
                ? {}
                : { getTransferAccess: props.getTransferAccess })}
              {...(props.onFixUnsupportedBlock === undefined
                ? {}
                : { onFixUnsupportedBlock: props.onFixUnsupportedBlock })}
            />
          </ExpansionItemKeyContext.Provider>
        ),
      )}
      {visibleBlockCount < props.indexes.length && (
        <Pressable
          accessibilityRole="button"
          onPress={() => {
            setVisibleBlockCount((current) => Math.min(props.indexes.length, current + 16));
          }}
          style={styles.activityMoreButton}
        >
          <Text style={styles.activityMoreText}>
            Show {Math.min(16, props.indexes.length - visibleBlockCount)} more
          </Text>
        </Pressable>
      )}
    </TurnActivity>
  );
}

type HistoryTurn = CompletedTurnHistoryProps["item"];

export function CompletedTurnHistory(props: CompletedTurnHistoryProps) {
  const rawTurn = props.item.turn;
  const [expanded, setExpanded] = usePersistentExpansion(
    `${props.item.key}:completed-history`,
    false,
  );
  const [loading, setLoading] = useRecyclingState(false);
  const [error, setError] = useRecyclingState<string | null>(null);
  const requestedTurnsRef = useRef(new Set<string>());
  const isExpanded = props.forceExpanded || expanded;
  const turns = historyTurns(props);
  const activitySummary = combinedActivitySummary(turns);
  const historyBlocks = isExpanded
    ? turns.flatMap((turn) => expandedHistoryBlocks(turn, foldsAnswer(props, turn)))
    : [];
  const sequence = chronologicalTurnSequence(historyBlocks);
  const load = () => {
    const onLoadItems = props.onLoadItems;
    const pending = turns.filter(
      (turn) => turn.turn.itemsView !== "full" && !requestedTurnsRef.current.has(turn.turn.id),
    );
    if (onLoadItems === undefined || pending.length === 0) {
      return;
    }
    for (const turn of pending) {
      requestedTurnsRef.current.add(turn.turn.id);
    }
    setLoading(true);
    setError(null);
    void Promise.all(pending.map(async (turn) => onLoadItems(turn.turn.id)))
      .catch((error: unknown) => {
        for (const turn of pending) {
          requestedTurnsRef.current.delete(turn.turn.id);
        }
        setError(error instanceof Error ? error.message : "Could not load activity");
      })
      .finally(() => {
        setLoading(false);
      });
  };
  // An empty group is never drawn: nothing counted, recorded or folded.
  if (!turns.some((turn) => turnHasHistory(turn) || foldsAnswer(props, turn))) {
    return null;
  }
  return (
    <TurnActivity
      compactHeader
      expanded={isExpanded}
      forceExpandCards={props.forceExpanded}
      label={
        loading
          ? "Loading activity…"
          : error !== null
            ? "Activity unavailable"
            : turnActivityLabel(
                activitySummary.kinds,
                props.compact,
                positiveCount(activitySummary.count),
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
      outputFootprint={activitySummary.outputFootprint}
    >
      {error !== null && <Text style={styles.agentPlaceholder}>{error}</Text>}
      {sequence.map((part) =>
        part.kind === "agent" ? (
          <RichMarkdown key={part.key} source={part.block.body ?? ""} />
        ) : (
          <TurnActivitySegment
            animateNew={false}
            compact={props.compact}
            forceExpanded={props.forceExpanded}
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

/** The finished turns whose activity this history shows, oldest first. */
function historyTurns(props: CompletedTurnHistoryProps): readonly HistoryTurn[] {
  if (props.bubbleTurns === undefined) {
    return [props.item];
  }
  return props.bubbleTurns.filter(
    (turn) => turn === props.item || turn.turn.status !== "inProgress",
  );
}

function turnHasHistory(turn: HistoryTurn): boolean {
  return hasCompletedTurnHistory(
    turn.turn,
    selectTurnRenderWindow(turn.turn).collapsedActivityIndexes,
  );
}

/** Whether this history also shows the turn's own answer (an earlier answer of a continued bubble). */
function foldsAnswer(props: CompletedTurnHistoryProps, turn: HistoryTurn): boolean {
  return props.bubbleTurns !== undefined && foldsAnswerIntoHistory(props.bubbleTurns, turn);
}

function expandedHistoryBlocks(
  turn: HistoryTurn,
  withAnswer: boolean,
): ReturnType<typeof projectThreadItem>[] {
  const rawTurn = turn.turn;
  if (rawTurn.itemsView !== "full") {
    return [];
  }
  const window = selectTurnRenderWindow(rawTurn);
  const indexes =
    withAnswer && window.latestAgentIndex >= 0
      ? [...window.collapsedActivityIndexes, window.latestAgentIndex].sort((a, b) => a - b)
      : window.collapsedActivityIndexes;
  const blocks = indexes.flatMap((index) => {
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
 * The Companion's activity totals of the shown turns. Several turns of one
 * bubble add up; a footprint cost is known only when every turn knows it.
 */
function combinedActivitySummary(turns: readonly HistoryTurn[]): {
  readonly count: number | undefined;
  readonly kinds: readonly string[];
  readonly outputFootprint: ActivityFootprint | null;
} {
  const summaries = turns.flatMap((turn) => {
    const summary = turnActivitySummary(turn);
    return summary === null ? [] : [summary];
  });
  if (summaries.length === 0) {
    return { count: undefined, kinds: [], outputFootprint: null };
  }
  return {
    count: summaries.reduce((sum, summary) => sum + summary.count, 0),
    kinds: [...new Set(summaries.flatMap((summary) => summary.kinds))],
    outputFootprint: summaries.reduce<ActivityFootprint | null>(
      (total, summary, index) =>
        index === 0 ? total : addFootprint(total, summary.outputFootprint),
      summaries[0]?.outputFootprint ?? null,
    ),
  };
}

/**
 * One turn's totals. The Companion counts the work of a turn without a user
 * message as pre-turn lifecycle and reports no activity for it; the bubble
 * draws that work as the response, so it counts the turn's own history items.
 */
function turnActivitySummary(turn: HistoryTurn): HistorySummary | null {
  const summary = projectedActivityMetrics(turn.turn)?.total;
  if (summary !== undefined && summary.count > 0) {
    return summary;
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

function addFootprint(
  total: ActivityFootprint | null,
  next: ActivityFootprint | null,
): ActivityFootprint | null {
  if (total === null || next === null) {
    return null;
  }
  return {
    ...total,
    bytes: total.bytes + next.bytes,
    estimatedInputCostUsd:
      total.estimatedInputCostUsd === null || next.estimatedInputCostUsd === null
        ? null
        : total.estimatedInputCostUsd + next.estimatedInputCostUsd,
    estimatedTokens: total.estimatedTokens + next.estimatedTokens,
  };
}

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
