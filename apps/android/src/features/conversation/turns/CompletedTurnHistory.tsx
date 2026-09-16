import type { CollapsedTurnActivityProps } from "./CollapsedTurnActivity.types";
import type { CompletedTurnHistoryProps } from "./CompletedTurnHistory.types";
/** V1 CompletedTurnHistory owner, extracted without changing interaction or resource lifetime. */
import { projectedTurnMetadata } from "@codewide/sync-client";
import { useRecyclingState } from "@legendapp/list/react-native";
import { useRef } from "react";
import { Pressable } from "react-native";
import { activityOutputFootprint } from "../../../rendering/command-activity";
import { RichMarkdown } from "../../../rendering/RichMarkdown";
import { selectTurnRenderWindow } from "../../../rendering/thread-render-window";
import { chronologicalTurnSequence } from "../../../rendering/turn-sequence";
import { AppText as Text } from "../../../ui/Typography";
import { ProtocolBlock } from "../protocol/ProtocolBlock";
import { usePersistentExpansion } from "./Card";
import { styles } from "./CompletedTurnHistory.styles";
import { TurnActivity, TurnActivitySegment } from "./TurnActivity";
import { ExpansionItemKeyContext } from "./turnContexts";
import {
  projectThreadItem,
  turnActivityLabel,
  turnMetadataBlocks,
  turnMetadataKinds,
} from "./turnProjection";

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
  const outputFootprint = activityOutputFootprint(
    props.indexes.flatMap((index) => {
      const rawItem = rawTurn.items[index];
      if (rawItem === undefined || rawItem.type !== "commandExecution") {
        return [];
      }
      const raw: Record<string, unknown> = rawItem;
      return [
        {
          raw,
          visibleOutput: typeof raw.aggregatedOutput === "string" ? raw.aggregatedOutput : "",
        },
      ];
    }),
  );

  return (
    <TurnActivity
      expanded={isExpanded}
      forceExpandCards={props.forceExpanded}
      label={`${turnActivityLabel(activityKinds, props.compact)} · ${String(props.indexes.length)}`}
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
  const requestedTurnRef = useRef<string | null>(null);
  const isExpanded = props.forceExpanded || expanded;
  const activityItems = selectTurnRenderWindow(rawTurn).collapsedActivityIndexes.flatMap(
    (index) => {
      const rawItem = rawTurn.items[index];
      return rawItem === undefined ? [] : [{ index, rawItem }];
    },
  );
  const metadataKinds = turnMetadataKinds(rawTurn);
  const activitySummary = projectedTurnMetadata(rawTurn)?.activity;
  const hasFullItems = rawTurn.itemsView === "full";
  const activityKinds = [
    ...(hasFullItems
      ? activityItems.map(({ rawItem }) => rawItem.type)
      : (activitySummary?.kinds ?? [])),
    ...metadataKinds,
  ];
  const activityCount = hasFullItems
    ? activityItems.length + metadataKinds.length
    : (activitySummary?.count ?? 0) + metadataKinds.length;
  const outputFootprint = hasFullItems
    ? activityOutputFootprint(
        activityItems.flatMap(({ rawItem }) => {
          if (rawItem.type !== "commandExecution") {
            return [];
          }
          const raw: Record<string, unknown> = rawItem;
          return [
            {
              raw,
              visibleOutput: typeof raw.aggregatedOutput === "string" ? raw.aggregatedOutput : "",
            },
          ];
        }),
      )
    : (activitySummary?.outputFootprint ?? null);
  const historyBlocks =
    !isExpanded || rawTurn.itemsView !== "full"
      ? []
      : activityItems.map(({ index, rawItem }) => projectThreadItem(props.item, rawItem, index));
  if (isExpanded && rawTurn.itemsView === "full") {
    historyBlocks.push(...turnMetadataBlocks(props.item.key, rawTurn));
  }
  const sequence = chronologicalTurnSequence(historyBlocks);
  const load = () => {
    if (
      requestedTurnRef.current === rawTurn.id ||
      rawTurn.itemsView === "full" ||
      props.onLoadItems === undefined
    ) {
      return;
    }
    requestedTurnRef.current = rawTurn.id;
    setLoading(true);
    setError(null);
    void props
      .onLoadItems(rawTurn.id)
      .catch((error: unknown) => {
        requestedTurnRef.current = null;
        setError(error instanceof Error ? error.message : "Could not load activity");
      })
      .finally(() => {
        setLoading(false);
      });
  };
  if (rawTurn.itemsView === "full" && activityCount === 0) {
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
            : rawTurn.itemsView === "full"
              ? `${turnActivityLabel(activityKinds, props.compact)} · ${String(activityCount)}`
              : activityCount > 0
                ? `${turnActivityLabel(activityKinds, props.compact)} · ${String(activityCount)}`
                : "Activity"
      }
      loading={loading}
      onToggle={() => {
        const next = !isExpanded;
        setExpanded(next);
        if (next) {
          load();
        }
      }}
      outputFootprint={outputFootprint}
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
