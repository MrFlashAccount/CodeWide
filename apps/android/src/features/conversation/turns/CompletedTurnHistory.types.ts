import type { RenderBlock } from "@codewide/renderers";
import type { TimelineItem } from "../timeline/timelineTypes";

/** Inputs owned by this composition boundary; concrete state owners remain separate. */
export type CompletedTurnHistoryProps = {
  compact: boolean;
  forceExpanded: boolean;
  getTransferAccess?: () => Promise<{ authorization: string; baseUrl: string }>;
  item: Extract<TimelineItem, { kind: "turn" }>;
  onFixUnsupportedBlock?: (block: RenderBlock) => Promise<void>;
  onLoadItems?: (turnId: string) => Promise<void>;
};
