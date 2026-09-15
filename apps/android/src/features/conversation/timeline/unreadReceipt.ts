import type { TimelineItem } from "./timelineTypes";
import { View } from "react-native";
import { useConversationRef } from "../../../ui/use-conversation-scope";

export function useUnreadReceiptState(composerScope: string) {
  const latestUnreadAgentRef = useConversationRef<View | null>(composerScope, () => null);

  const unreadVisibilityFrameRef = useConversationRef<number | null>(composerScope, () => null);

  const unreadVisibilityScheduledKeyRef = useConversationRef<string | null>(
    composerScope,
    () => null,
  );

  const latestUnreadReceiptKeyRef = useConversationRef<string | null>(composerScope, () => null);

  const acknowledgedUnreadReceiptKeyRef = useConversationRef<string | null>(
    composerScope,
    () => null,
  );
  return {
    latestUnreadAgentRef,
    unreadVisibilityFrameRef,
    unreadVisibilityScheduledKeyRef,
    latestUnreadReceiptKeyRef,
    acknowledgedUnreadReceiptKeyRef,
  };
}

import { useEvent } from "../../../react/useEvent";
import {
  claimUnreadReceipt,
  shouldMarkAgentResponseRead,
} from "../../../rendering/unread-visibility";

export function useUnreadReceiptActions({
  latestUnreadAgentRef,
  unreadVisibilityFrameRef,
  unreadVisibilityScheduledKeyRef,
  latestUnreadReceiptKeyRef,
  acknowledgedUnreadReceiptKeyRef,
  timelineViewportRef,
  latestUnreadReceiptKey,
  onViewedLatest,
}: ReturnType<typeof useUnreadReceiptState> & {
  timelineViewportRef: import("react").RefObject<View | null>;
  latestUnreadReceiptKey: string | null;
  onViewedLatest: (() => void) | undefined;
}) {
  const acknowledgeUnreadReceipt = useEvent((receiptKey: string) => {
    const claimed = claimUnreadReceipt(
      latestUnreadReceiptKeyRef.current,
      acknowledgedUnreadReceiptKeyRef.current,
      receiptKey,
    );
    if (claimed === null) return;
    acknowledgedUnreadReceiptKeyRef.current = claimed;
    onViewedLatest?.();
  });

  const checkUnreadAgentVisibility = useEvent((receiptKey: string) => {
    const viewport = timelineViewportRef.current;
    const agent = latestUnreadAgentRef.current;
    if (viewport === null || agent === null) return;
    if (acknowledgedUnreadReceiptKeyRef.current === receiptKey) return;
    viewport.measureInWindow((_viewportX, viewportY, _viewportWidth, viewportHeight) => {
      agent.measureInWindow((_agentX, agentY, _agentWidth, agentHeight) => {
        if (latestUnreadReceiptKeyRef.current !== receiptKey) return;
        if (!shouldMarkAgentResponseRead(agentY, agentHeight, viewportY, viewportHeight)) return;
        acknowledgeUnreadReceipt(receiptKey);
      });
    });
  });

  const scheduleUnreadAgentVisibilityCheck = useEvent(() => {
    const receiptKey = latestUnreadReceiptKey;
    latestUnreadReceiptKeyRef.current = receiptKey;
    if (receiptKey === null) {
      if (unreadVisibilityFrameRef.current !== null)
        cancelAnimationFrame(unreadVisibilityFrameRef.current);
      unreadVisibilityFrameRef.current = null;
      unreadVisibilityScheduledKeyRef.current = null;
      return;
    }
    if (unreadVisibilityFrameRef.current !== null) {
      if (unreadVisibilityScheduledKeyRef.current === receiptKey) return;
      cancelAnimationFrame(unreadVisibilityFrameRef.current);
    }
    unreadVisibilityScheduledKeyRef.current = receiptKey;
    unreadVisibilityFrameRef.current = requestAnimationFrame(() => {
      unreadVisibilityFrameRef.current = null;
      unreadVisibilityScheduledKeyRef.current = null;
      checkUnreadAgentVisibility(receiptKey);
    });
  });

  const commitUnreadReceipt = useEvent(() => {
    latestUnreadReceiptKeyRef.current = latestUnreadReceiptKey;
    if (latestUnreadReceiptKey === null) acknowledgedUnreadReceiptKeyRef.current = null;
    scheduleUnreadAgentVisibilityCheck();
    return () => {
      if (unreadVisibilityFrameRef.current !== null)
        cancelAnimationFrame(unreadVisibilityFrameRef.current);
      unreadVisibilityFrameRef.current = null;
      unreadVisibilityScheduledKeyRef.current = null;
    };
  });

  const setLatestUnreadAgentNode = useEvent((node: View | null) => {
    latestUnreadAgentRef.current = node;
    if (node !== null) scheduleUnreadAgentVisibilityCheck();
  });
  return {
    acknowledgeUnreadReceipt,
    scheduleUnreadAgentVisibilityCheck,
    commitUnreadReceipt,
    setLatestUnreadAgentNode,
  };
}

import { measureThreadNavigationWork } from "../../../data/thread-navigation-metrics";
import { selectTurnRenderWindow } from "../../../rendering/thread-render-window";

export function projectUnreadReceipt(
  timeline: TimelineItem[],
  unread: number,
  composerScope: string,
  draftConnectionId: string | null,
  draftThreadId: string | null,
) {
  const latestUnreadAgentTurnId = measureThreadNavigationWork(
    draftConnectionId ?? "",
    draftThreadId,
    "scan_unread_agent_turn",
    () => {
      if (unread <= 0) return null;
      for (let index = timeline.length - 1; index >= 0; index -= 1) {
        const item = timeline[index];
        if (item?.kind !== "turn" || item.turn.status === "inProgress") continue;
        if (selectTurnRenderWindow(item.turn).latestAgentIndex >= 0) return item.id;
      }
      return null;
    },
    { values: { itemCount: timeline.length } },
  );

  const latestUnreadReceiptKey =
    latestUnreadAgentTurnId === null ? null : `${composerScope}\u0000${latestUnreadAgentTurnId}`;
  return { latestUnreadAgentTurnId, latestUnreadReceiptKey };
}
