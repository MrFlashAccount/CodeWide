import type { MainThreadReadCapabilities } from "../mainThreadReadCapabilities";
import { useHistoryAnchorState } from "./historyAnchor";
import { useTimelineSearchState } from "./timelineSearch";
import { useTimelineViewportState } from "./timelineViewport";
import { useUnreadReceiptState } from "./unreadReceipt";

export function useConversationTimelineState({
  composerScope,
  searchWindow,
  composerState,
  draftConnectionId,
  draftThreadId,
  readInputs,
}: {
  composerScope: string;
  searchWindow: Exclude<MainThreadReadCapabilities["searchWindow"], undefined>;
  composerState: Exclude<MainThreadReadCapabilities["composerState"], undefined>;
  draftConnectionId: string | null;
  draftThreadId: string | null;
  readInputs: MainThreadReadCapabilities;
}) {
  const timelineSearchStateBinding = useTimelineSearchState(composerScope, searchWindow);
  const timelineViewportStateBinding = useTimelineViewportState(composerScope);
  const unreadReceiptStateBinding = useUnreadReceiptState(composerScope);
  const historyAnchorStateBinding = useHistoryAnchorState(
    composerScope,
    composerState,
    searchWindow,
    draftConnectionId,
    draftThreadId,
    readInputs.saveScrollOffset,
  );
  return {
    timelineViewportStateBinding,
    historyAnchorStateBinding,
    unreadReceiptStateBinding,
    timelineSearchStateBinding,
  };
}
