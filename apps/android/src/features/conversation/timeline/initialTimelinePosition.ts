import { useConversationState } from "../../../ui/use-conversation-scope";
import type { TimelineInitialPosition } from "../../../rendering/ThreadTimelineList";
import type { TimelineItem } from "./timelineTypes";
import type { SearchConversationWindow } from "../../search/search-conversation-window";

export function useInitialTimelinePosition(
  searchTimelineScope: string,
  timelineModelReady: boolean,
  timeline: TimelineItem[],
  initialRestoreAnchorTurnId: string | null,
  initialHistoryRestore: { viewportOffsetPx: number },
  searchWindow: SearchConversationWindow | null,
): TimelineInitialPosition {
  // LegendList may consult its initial target again while a bootstrap layout
  // is still settling. Freeze both the target and its index for this chat activation
  // inside the persistent ConversationPane; window prepend/append must be governed
  // exclusively by maintainVisibleContentPosition after that.
  const [storedTimelineInitialPosition, setTimelineInitialPosition] =
    useConversationState<TimelineInitialPosition | null>(searchTimelineScope, () => null);
  if (timelineModelReady && storedTimelineInitialPosition === null) {
    const anchorIndex =
      initialRestoreAnchorTurnId === null
        ? -1
        : timeline.findIndex(
            (item) => item.kind === "turn" && item.id === initialRestoreAnchorTurnId,
          );
    setTimelineInitialPosition(
      anchorIndex < 0
        ? { kind: "tail" }
        : {
            index: anchorIndex,
            kind: "item",
            viewOffset: searchWindow === null ? initialHistoryRestore.viewportOffsetPx : 0,
            viewPosition: 0,
          },
    );
  }
  const timelineInitialPosition: TimelineInitialPosition = storedTimelineInitialPosition ?? {
    kind: "tail",
  };

  return timelineInitialPosition;
}
