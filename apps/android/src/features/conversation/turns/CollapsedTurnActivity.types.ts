import { type RenderBlock } from "@codewide/renderers";
import { type TimelineItem } from "../timeline/timelineTypes";

/** Inputs owned by this composition boundary; concrete state owners remain separate. */
export type CollapsedTurnActivityProps = {
  item: Extract<TimelineItem, { kind: "turn" }>;
  indexes: number[];
  compact: boolean;
  forceExpanded: boolean;
  getTransferAccess?(): Promise<{ baseUrl: string; authorization: string }>;
  onFixUnsupportedBlock?(block: RenderBlock): Promise<void>;
};
