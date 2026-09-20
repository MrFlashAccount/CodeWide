import type { MainThreadReadCapabilities } from "../mainThreadReadCapabilities";
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
  const historyAnchorStateBinding = useHistoryAnchorState(
    composerScope,
    draftConnectionId,
    draftThreadId,
    readInputs.saveScrollOffset,
  );
  return {
    historyAnchorStateBinding,
    timelineJumpStateBinding,
    timelineSearchStateBinding,
    timelineViewportStateBinding,
    unreadReceiptStateBinding,
  };
}
