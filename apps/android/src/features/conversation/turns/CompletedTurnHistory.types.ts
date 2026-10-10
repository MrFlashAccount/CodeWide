import type { RenderBlock } from "@codewide/renderers";
import type { TimelineItem } from "../timeline/timelineTypes";

/** Inputs owned by this composition boundary; concrete state owners remain separate. */
export type CompletedTurnHistoryProps = {
  /**
   * Every turn drawn in the same bubble, starting with `item`: the finished
   * continuations (turns without a user message) join this one history
   * group, in order.
   */
  bubbleTurns?: readonly Extract<TimelineItem, { kind: "turn" }>[];
  compact: boolean;
  forceExpanded: boolean;
  getTransferAccess?: () => Promise<{ authorization: string; baseUrl: string }>;
  item: Extract<TimelineItem, { kind: "turn" }>;
  onFixUnsupportedBlock?: (block: RenderBlock) => Promise<void>;
  onLoadItems?: (turnId: string) => Promise<void>;
};
