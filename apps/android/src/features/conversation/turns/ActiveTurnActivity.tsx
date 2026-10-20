import type { RenderBlock } from "@codewide/renderers";
import { useRecyclingState } from "@legendapp/list/react-native";
import { useContext, type ReactElement } from "react";
import { View } from "react-native";
import type { TransferAccess } from "../../../data/private-transfer";
import { useEvent } from "../../../react/useEvent";
import { blockActivitySummary, collapsedActivitySummary } from "../../../rendering/activityMetrics";
import type { TurnSequencePart } from "../../../rendering/turn-sequence";
import { ProtocolBlock } from "../protocol/ProtocolBlock";
import { ActivityDetailSheet } from "./ActivityDetailSheet";
import { styles } from "./TurnActivity.styles";
import { TurnActivity } from "./TurnActivity";
import {
  ActiveToolCallContext,
  ExpansionItemKeyContext,
  TurnActivityMetricsContext,
} from "./turnContexts";
import { projectThreadItem, turnActivityLabel } from "./turnProjection";
import type { TurnTimelineItemProps } from "./TurnTimelineItem.types";

/** How many of the newest actions a running turn shows under its activity row. */
const CURRENT_ACTION_LIMIT = 2;
const RUNNING_STATUSES: ReadonlySet<string> = new Set(["inProgress", "running"]);

type ActiveTurnActivityProps = {
  compact: boolean;
  /** Older actions of the same group that the render window keeps unmaterialized. */
  earlierIndexes: readonly number[];
  getTransferAccess?: () => Promise<TransferAccess>;
  onFixUnsupportedBlock?: (block: RenderBlock) => Promise<void>;
  part: Extract<TurnSequencePart, { kind: "activity" }>;
  turn: TurnTimelineItemProps["turn"];
};

/**
 * The group of actions a running turn is doing now. It reads like the
 * collapsed groups between its texts: one row with the group's count, plus
 * only the actions running now (else the newest one). The row opens a sheet
 * with every action of the group; the turn's texts stay visible around it.
 */
export function ActiveTurnActivity(props: ActiveTurnActivityProps): ReactElement {
  const metrics = useContext(TurnActivityMetricsContext);
  // The row lives in a recycled list cell.
  const [sheetVisible, setSheetVisible] = useRecyclingState(false);
  const openSheet = useEvent(() => {
    setSheetVisible(true);
  });
  const closeSheet = useEvent(() => {
    setSheetVisible(false);
  });
  const label = activeGroupLabel(props, blockActivitySummary(props.part.blocks, metrics));
  return (
    <View testID="active-turn-activity">
      <TurnActivity expanded={false} label={label} loading onToggle={openSheet} opensSheet>
        {null}
      </TurnActivity>
      <CurrentActions blocks={currentActions(props.part.blocks)} turnKey={props.turn.key} />
      <ActivityDetailSheet
        blocks={sheetVisible ? groupBlocks(props) : props.part.blocks}
        onClose={closeSheet}
        turnKey={props.turn.key}
        turnStatus="inProgress"
        visible={sheetVisible}
        {...(props.getTransferAccess === undefined
          ? {}
          : { getTransferAccess: props.getTransferAccess })}
        {...(props.onFixUnsupportedBlock === undefined
          ? {}
          : { onFixUnsupportedBlock: props.onFixUnsupportedBlock })}
      />
    </View>
  );
}

function CurrentActions({
  blocks,
  turnKey,
}: {
  blocks: readonly RenderBlock[];
  turnKey: string;
}): ReactElement {
  return (
    <View style={styles.turnActivityList} testID="active-turn-current-actions">
      {blocks.map((block) => (
        <CurrentAction block={block} key={block.key} turnKey={turnKey} />
      ))}
    </View>
  );
}

function CurrentAction({ block, turnKey }: { block: RenderBlock; turnKey: string }): ReactElement {
  return (
    <ActiveToolCallContext.Provider value>
      <ExpansionItemKeyContext.Provider value={`${turnKey}:${block.key}`}>
        <ProtocolBlock block={block} />
      </ExpansionItemKeyContext.Provider>
    </ActiveToolCallContext.Provider>
  );
}

/** The actions running now, else the newest one, at most `CURRENT_ACTION_LIMIT`. */
function currentActions(blocks: readonly RenderBlock[]): readonly RenderBlock[] {
  const running = blocks.filter(
    (block) => block.status !== null && RUNNING_STATUSES.has(block.status),
  );
  return (running.length > 0 ? running : blocks).slice(-CURRENT_ACTION_LIMIT);
}

function activeGroupLabel(
  props: ActiveTurnActivityProps,
  live: ReturnType<typeof blockActivitySummary>,
): string {
  const earlier = earlierSummary(props);
  const liveKinds = live?.kinds ?? props.part.blocks.map((block) => block.kind);
  const kinds = [...new Set([...earlier.kinds, ...liveKinds])];
  const count = earlier.count + (live?.count ?? props.part.blocks.length);
  return turnActivityLabel(kinds, props.compact, count);
}

/** The Companion's totals of the group's unmaterialized start, else its own items. */
function earlierSummary(props: ActiveTurnActivityProps): {
  readonly count: number;
  readonly kinds: readonly string[];
} {
  if (props.earlierIndexes.length === 0) {
    return { count: 0, kinds: [] };
  }
  const summary = collapsedActivitySummary(props.turn.turn, props.earlierIndexes);
  if (summary !== null) {
    return summary;
  }
  const kinds = props.earlierIndexes.flatMap((index) => {
    const item = props.turn.turn.items[index];
    return item === undefined ? [] : [item.type];
  });
  return { count: kinds.length, kinds };
}

/** Every action of the group for the sheet: the unmaterialized older ones, then the live ones. */
function groupBlocks(props: ActiveTurnActivityProps): readonly RenderBlock[] {
  if (props.earlierIndexes.length === 0) {
    return props.part.blocks;
  }
  const earlier = props.earlierIndexes.flatMap((index) => {
    const item = props.turn.turn.items[index];
    return item === undefined ? [] : [projectThreadItem(props.turn, item, index)];
  });
  return [...earlier, ...props.part.blocks];
}
