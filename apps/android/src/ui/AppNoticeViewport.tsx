import { useState, useSyncExternalStore } from "react";
import { StyleSheet, View } from "react-native";

import { useEvent } from "../react/useEvent";
import { spacing } from "../theme";
import { AppNoticeCard } from "./AppNoticeCard";
import { appNoticeStore, type NoticeEntry } from "./appNoticeStore";

const STACK_OFFSET = 16;
const STACK_GAP = 14;
const VISIBLE_NOTICES = 3;
const FALLBACK_HEIGHT = 56;
const MAX_NOTICE_WIDTH = 440;

/** The ReactiCx-style stack, shared by the web root and Android's top window. */
export function AppNoticeViewport(): React.JSX.Element | null {
  const notices = useSyncExternalStore(
    appNoticeStore.subscribe,
    appNoticeStore.getSnapshot,
    appNoticeStore.getSnapshot,
  );
  const [heights, setHeights] = useState<ReadonlyMap<number, number>>(() => new Map());
  const [expandRequested, setExpandRequested] = useState(false);
  const [interacting, setInteracting] = useState(false);
  const expanded = expandRequested && notices.length > 1;
  const toggleExpanded = useEvent(() => {
    setExpandRequested((current) => !current);
  });
  const onHeight = useEvent((id: number, height: number) => {
    setHeights((current) => updateHeight(current, id, height));
  });
  const onInteractingChange = useEvent((value: boolean) => {
    setInteracting(value);
  });
  if (notices.length === 0) {
    return null;
  }
  return (
    <NoticeStack
      expanded={expanded}
      heights={heights}
      interacting={interacting}
      notices={notices}
      onHeight={onHeight}
      onInteractingChange={onInteractingChange}
      onToggleExpanded={toggleExpanded}
    />
  );
}

function updateHeight(
  current: ReadonlyMap<number, number>,
  id: number,
  height: number,
): ReadonlyMap<number, number> {
  if (height === 0 && !current.has(id)) {
    return current;
  }
  if (height > 0 && current.get(id) === height) {
    return current;
  }
  // A state update transfers ownership of this snapshot to React.
  const next = new Map(current);
  if (height === 0) {
    next.delete(id);
  } else {
    next.set(id, height);
  }
  return next;
}

function NoticeStack({
  expanded,
  heights,
  interacting,
  notices,
  onHeight,
  onInteractingChange,
  onToggleExpanded,
}: {
  readonly expanded: boolean;
  readonly heights: ReadonlyMap<number, number>;
  readonly interacting: boolean;
  readonly notices: readonly NoticeEntry[];
  readonly onHeight: (id: number, height: number) => void;
  readonly onInteractingChange: (interacting: boolean) => void;
  readonly onToggleExpanded: () => void;
}): React.JSX.Element {
  let expandedHeight = 0;
  const cards: React.JSX.Element[] = [];
  for (let index = 0; index < notices.length; index += 1) {
    const entry = notices[index];
    if (entry === undefined) {
      break;
    }
    const offset = expanded ? expandedHeight : index * STACK_OFFSET;
    expandedHeight += expandedHeightIncrement(index, entry, heights);
    cards.push(
      <AppNoticeCard
        entry={entry}
        expanded={expanded}
        index={index}
        interacting={interacting}
        key={entry.id}
        offset={offset}
        onHeight={onHeight}
        onInteractingChange={onInteractingChange}
        onToggleExpanded={onToggleExpanded}
        visible={index < VISIBLE_NOTICES}
      />,
    );
  }
  const newest = notices[0];
  const stackHeight = expanded
    ? expandedHeight - STACK_GAP
    : (newest === undefined ? FALLBACK_HEIGHT : (heights.get(newest.id) ?? FALLBACK_HEIGHT)) +
      Math.min(notices.length - 1, VISIBLE_NOTICES - 1) * STACK_OFFSET;
  return (
    <View pointerEvents="box-none" style={styles.viewport}>
      <View
        pointerEvents="box-none"
        style={[styles.stack, { height: stackHeight }]}
        testID="app-notice-stack"
      >
        {cards}
      </View>
    </View>
  );
}

function expandedHeightIncrement(
  index: number,
  entry: NoticeEntry,
  heights: ReadonlyMap<number, number>,
): number {
  if (index >= VISIBLE_NOTICES) {
    return 0;
  }
  return (heights.get(entry.id) ?? FALLBACK_HEIGHT) + STACK_GAP;
}

const styles = StyleSheet.create({
  stack: {
    alignSelf: "center",
    maxWidth: MAX_NOTICE_WIDTH,
    width: "100%",
  },
  viewport: {
    alignSelf: "center",
    paddingHorizontal: spacing.xs,
    paddingVertical: spacing.xs,
    width: "100%",
  },
});
