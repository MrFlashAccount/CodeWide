import type { RenderBlock } from "@codewide/renderers";
import type { TurnUsageProjection } from "@codewide/sync-client";
import type { ReactNode } from "react";
import type { View } from "react-native";
import type { TimelineItem } from "../timeline/timelineTypes";
import type { TransferAccess } from "../../../data/private-transfer";

/** Inputs owned by this composition boundary; concrete state owners remain separate. */
export type TurnTimelineItemProps = {
  agentDateLabel?: string | null;
  animateLiveUpdates: boolean;
  compact: boolean;
  forceExpanded?: boolean;
  getTransferAccess?: () => Promise<TransferAccess>;
  latestAgentRef?: (node: View | null) => void;
  onFixUnsupportedBlock?: (block: RenderBlock) => Promise<void>;
  onForkThroughTurn?: (turnId: string) => void;
  onLatestAgentLayout?: () => void;
  onLoadItems?: (turnId: string) => Promise<void>;
  requestPrompt: ReactNode;
  turn: Extract<TimelineItem, { kind: "turn" }>;
  usage?: TurnUsageProjection | null;
};
