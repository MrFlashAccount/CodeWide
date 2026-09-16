import type { TimelineItem } from "./timeline/timelineTypes";
import type { Thread } from "@codewide/codex-protocol/v0.147.0/v2";
import { threadFailureNotice, type ThreadCurrentOutcome } from "../../data/thread-current-outcome";
import {
  activeTurnId,
  isThreadLifecycleActive,
  pendingDeliveryMayOwnTurn,
} from "../../data/thread-lifecycle";
import { selectLiveTurnPlan } from "../../rendering/live-turn-plan";
import type { ThreadListItem } from "../threadList/threadListTypes";

export function projectConversationPresentation(
  remoteThread: Thread | null | undefined,
  completeTurnHeaders: boolean,
  timeline: TimelineItem[],
  threadState: ThreadListItem["state"] | undefined,
  currentOutcome: ThreadCurrentOutcome | null,
) {
  const completeTurnHeadersResident =
    remoteThread !== null && remoteThread !== undefined && completeTurnHeaders;

  const sessionCompactionCount =
    completeTurnHeadersResident &&
    remoteThread.turns.every((candidate) => candidate.itemsView === "full")
      ? remoteThread.turns.reduce(
          (count, candidate) =>
            count + candidate.items.filter((item) => item.type === "contextCompaction").length,
          0,
        )
      : null;

  const pendingDeliveryOwnsTurn = timeline.some(
    (item) => item.kind === "optimistic" && pendingDeliveryMayOwnTurn(item.status),
  );

  const threadLifecycleActive = isThreadLifecycleActive(threadState) || pendingDeliveryOwnsTurn;

  const failureNotice = threadFailureNotice(currentOutcome, remoteThread);

  const currentTurnId = threadLifecycleActive ? activeTurnId(remoteThread) : null;

  const liveTurnPlan = selectLiveTurnPlan(remoteThread, currentTurnId);
  return {
    currentTurnId,
    failureNotice,
    liveTurnPlan,
    sessionCompactionCount,
    threadLifecycleActive,
  };
}
