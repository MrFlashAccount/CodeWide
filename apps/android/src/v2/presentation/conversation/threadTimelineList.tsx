import { KeyboardAwareLegendList } from "@legendapp/list/keyboard";
import type { LegendListProps } from "@legendapp/list/react-native";
import type { ReactElement } from "react";

import { legendInitialPositionProps } from "./timelineInitialPosition";
import type { TimelineInitialPosition } from "./timelineInitialPosition";

const TIMELINE_ESTIMATED_ITEM_SIZE = 480;
const TIMELINE_TAIL_FOLLOW_THRESHOLD = 0.02;
const TIMELINE_TAIL_FOLLOW_CONFIG = {
  animated: false,
  on: { dataChange: true, itemLayout: true },
} as const;

type KeyboardLiftBehavior = "always" | "whenAtEnd" | "persistent" | "never";

export type ThreadTimelineListProps<ItemT> = Omit<
  LegendListProps<ItemT>,
  | "alignItemsAtEnd"
  | "anchoredEndSpace"
  | "contentInsetEndAdjustment"
  | "dataKey"
  | "drawDistance"
  | "estimatedItemSize"
  | "initialScrollAtEnd"
  | "initialScrollIndex"
  | "maintainScrollAtEnd"
  | "maintainScrollAtEndThreshold"
  | "maintainVisibleContentPosition"
  | "recycleItems"
  | "refScrollView"
  | "renderScrollComponent"
> & {
  followTail?: boolean;
  initialPosition?: TimelineInitialPosition;
  keyboardLiftBehavior?: KeyboardLiftBehavior;
  keyboardOffset?: number;
  measurementRevision: string;
  renderRevision: string;
};

export function ThreadTimelineList<ItemT>(props: ThreadTimelineListProps<ItemT>): ReactElement {
  const {
    followTail = false,
    initialPosition = { kind: "tail" },
    itemsAreEqual,
    keyboardLiftBehavior = "whenAtEnd",
    keyboardOffset = 0,
    measurementRevision,
    renderRevision,
    ...listProps
  } = props;
  const KeyboardAwareTimelineList = KeyboardAwareLegendList as unknown as (
    listProps: LegendListProps<ItemT> & {
      keyboardLiftBehavior: KeyboardLiftBehavior;
      keyboardOffset: number;
    },
  ) => ReactElement;
  return (
    <KeyboardAwareTimelineList
      {...listProps}
      {...legendInitialPositionProps(initialPosition)}
      alignItemsAtEnd
      dataKey={`${renderRevision}:${measurementRevision}`}
      drawDistance={250}
      estimatedItemSize={TIMELINE_ESTIMATED_ITEM_SIZE}
      itemsAreEqual={itemsAreEqual ?? referenceEqual}
      keyboardLiftBehavior={keyboardLiftBehavior}
      keyboardOffset={keyboardOffset}
      maintainScrollAtEnd={followTail ? TIMELINE_TAIL_FOLLOW_CONFIG : false}
      maintainScrollAtEndThreshold={TIMELINE_TAIL_FOLLOW_THRESHOLD}
      maintainVisibleContentPosition={{ data: true, size: true }}
      recycleItems={false}
    />
  );
}

function referenceEqual<ItemT>(previous: ItemT, next: ItemT): boolean {
  return previous === next;
}
