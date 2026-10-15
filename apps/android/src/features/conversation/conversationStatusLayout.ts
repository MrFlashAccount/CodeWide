import { controlSize } from "../../theme";
import {
  conversationBottomContentInset,
  conversationHeaderChromeHeight,
} from "../../ui/conversation-chrome-layout";
import type { useConversationScopeFeatures } from "./conversationScopeFeatures";
import type { useConversationTimelineRead } from "./timeline/conversationTimelineRead";

const INLINE_QUEUE_MIN_ROWS = 3;

type ConversationStatusLayout = {
  readonly currentGoal: NonNullable<
    ReturnType<typeof useConversationScopeFeatures>["goalResource"]
  >["goal"];
  readonly inlineQueueMaxHeight: number;
  readonly liveStatusVisible: boolean;
};

/** Derives the status-strip occupancy and remaining inline queue height. */
export function conversationStatusLayout(
  scoped: ReturnType<typeof useConversationScopeFeatures>,
  timelineRead: ReturnType<typeof useConversationTimelineRead>,
  hasWorkingAgents: boolean,
): ConversationStatusLayout {
  const searchActive = timelineRead.timelineSearchProjectionBinding.threadSearchActive;
  const currentGoal = scoped.goalResource?.goal ?? null;
  const liveStatusVisible = shouldShowConversationStatus({
    hasGoal: currentGoal !== null,
    hasLiveTurnPlan: timelineRead.conversationPresentationBinding.liveTurnPlan !== null,
    hasWorkingAgents,
    searchActive,
    timelinePositioned: timelineRead.timelinePositioned,
  });
  const inlineQueueMaxHeight = Math.max(
    controlSize.touch * INLINE_QUEUE_MIN_ROWS,
    scoped.activation.conversationPaneGeometryBinding.conversationPaneHeight -
      conversationHeaderChromeHeight(
        scoped.timelineState.timelineSearchStateBinding.threadSearchVisible,
      ) -
      conversationBottomContentInset(
        scoped.timelineState.timelineViewportStateBinding.bottomChromeHeight,
        liveStatusVisible,
      ),
  );
  return { currentGoal, inlineQueueMaxHeight, liveStatusVisible };
}

/** Keeps the shared status surface visible for any of its independent contents. */
export function shouldShowConversationStatus({
  hasGoal,
  hasLiveTurnPlan,
  hasWorkingAgents,
  searchActive,
  timelinePositioned,
}: {
  readonly hasGoal: boolean;
  readonly hasLiveTurnPlan: boolean;
  readonly hasWorkingAgents: boolean;
  readonly searchActive: boolean;
  readonly timelinePositioned: boolean;
}): boolean {
  return (hasGoal || hasLiveTurnPlan || hasWorkingAgents) && timelinePositioned && !searchActive;
}
