import type { MainThreadReadCapabilities } from "../mainThreadReadCapabilities";
import { useThreadReadingPosition } from "./threadReadingPosition";
import { useHistoryAnchorState } from "./historyAnchor";
import { useTimelineSearchState } from "./timelineSearch";
import { useTimelineJumpState } from "./timelineJump";
import { useTimelineViewportState } from "./timelineViewport";
import { useUnreadReceiptState } from "./unreadReceipt";

export function useConversationTimelineState({
  composerScope,
  draftConnectionId,
  draftThreadId,
  readInputs,
  searchWindow,
}: {
  composerScope: string;
  draftConnectionId: string | null;
  draftThreadId: string | null;
  readInputs: MainThreadReadCapabilities;
  searchWindow: Exclude<MainThreadReadCapabilities["searchWindow"], undefined>;
}) {
  const timelineSearchStateBinding = useTimelineSearchState(composerScope, searchWindow);
  const timelineViewportStateBinding = useTimelineViewportState(composerScope);
  const unreadReceiptStateBinding = useUnreadReceiptState(composerScope);
  const timelineJumpStateBinding = useTimelineJumpState(composerScope);
  const reading = useThreadReadingPosition(draftConnectionId, draftThreadId);
  const historyAnchorStateBinding = useHistoryAnchorState(
    composerScope,
    draftConnectionId,
    draftThreadId,
    reading?.session.save ?? readInputs.saveScrollOffset,
  );
  return {
    historyAnchorStateBinding,
    timelineJumpStateBinding,
    timelineSearchStateBinding,
    timelineViewportStateBinding,
    unreadReceiptStateBinding,
  };
}
