import { type RenderBlock } from "@codewide/renderers";
import { type TimelineItem } from "../timeline/timelineTypes";

/** Inputs owned by this composition boundary; concrete state owners remain separate. */
export type CompletedTurnHistoryProps = {
  item: Extract<TimelineItem, { kind: "turn" }>;
  compact: boolean;
  forceExpanded: boolean;
  getTransferAccess?(): Promise<{ baseUrl: string; authorization: string }>;
  onFixUnsupportedBlock?(block: RenderBlock): Promise<void>;
  onLoadItems?(turnId: string): Promise<void>;
};
