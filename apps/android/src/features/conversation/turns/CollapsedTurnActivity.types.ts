import type { RenderBlock } from "@codewide/renderers";
import type { TimelineItem } from "../timeline/timelineTypes";
import type { TransferAccess } from "../../../data/private-transfer";

/** Inputs owned by this composition boundary; concrete state owners remain separate. */
export type CollapsedTurnActivityProps = {
  compact: boolean;
  forceExpanded: boolean;
  getTransferAccess?: () => Promise<TransferAccess>;
  indexes: number[];
  item: Extract<TimelineItem, { kind: "turn" }>;
  onFixUnsupportedBlock?: (block: RenderBlock) => Promise<void>;
};
