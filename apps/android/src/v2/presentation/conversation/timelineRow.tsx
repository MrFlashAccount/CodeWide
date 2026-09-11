import { createContext, useContext, type ReactNode } from "react";
import { StyleSheet, View } from "react-native";

import type {
  TimelineActivityActions,
  TimelineDisplayResponseRow,
  TimelineDisplayTurn,
  TimelineTurnActionsResolver,
} from "./timelineTypes";
import { TimelineTurnView } from "./timelineTurnView";
import { TimelineDateSeparator } from "./timelineDateSeparator";
import type { TimelineTurnDateLabels } from "../../../presentation/conversation/timelineDates";

interface TimelineRenderItem {
  item: TimelineDisplayTurn;
}

interface TimelineRowContextValue {
  activityActions?: TimelineActivityActions;
  actionsForTurn?: TimelineTurnActionsResolver;
  dateLabels: ReadonlyMap<string, TimelineTurnDateLabels>;
  latestAssistantTurnId: string | null;
  latestAssistantMeasurementKey?: string | null;
  onLatestAssistantLayout?(): void;
  onLoadActivity?(turnId: string): Promise<TimelineDisplayResponseRow[]>;
  setLatestAssistantNode?(node: View | null): void;
}

interface TimelineRowProviderProps extends TimelineRowContextValue {
  children: ReactNode;
}

interface TimelineRowProps {
  turn: TimelineDisplayTurn;
}

const TimelineRowContext = createContext<TimelineRowContextValue>({
  dateLabels: new Map(),
  latestAssistantTurnId: null,
});

export function TimelineRowProvider(props: TimelineRowProviderProps): React.JSX.Element {
  const { children, ...value } = props;
  return <TimelineRowContext.Provider value={value}>{children}</TimelineRowContext.Provider>;
}

export function renderTimelineItem(value: TimelineRenderItem): React.JSX.Element {
  return <TimelineRow turn={value.item} />;
}

function TimelineRow(props: TimelineRowProps): React.JSX.Element {
  const { turn } = props;
  const context = useContext(TimelineRowContext);
  const actions = context.actionsForTurn?.(turn);
  const latestAssistant = context.latestAssistantTurnId === turn.id;
  const dateLabels = context.dateLabels.get(turn.id);
  const dateLabel = dateLabels?.before ?? null;
  return (
    <View style={styles.row}>
      {dateLabel === null ? null : <TimelineDateSeparator label={dateLabel} />}
      <TimelineTurnView
        agentDateLabel={dateLabels?.agent ?? null}
        {...(context.activityActions === undefined
          ? {}
          : { activityActions: context.activityActions })}
        {...(actions === undefined ? {} : { actions })}
        {...(latestAssistant && context.onLatestAssistantLayout !== undefined
          ? { onLatestAssistantLayout: context.onLatestAssistantLayout }
          : {})}
        {...(latestAssistant
          ? { latestAssistantMeasurementKey: context.latestAssistantMeasurementKey ?? null }
          : {})}
        {...(context.onLoadActivity === undefined
          ? {}
          : { onLoadActivity: context.onLoadActivity })}
        {...(latestAssistant && context.setLatestAssistantNode !== undefined
          ? { latestAssistantRef: context.setLatestAssistantNode }
          : {})}
        turn={turn}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  row: { width: "100%" },
});
