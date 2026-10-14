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
      forceExpandCards={props.forceExpanded}
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
