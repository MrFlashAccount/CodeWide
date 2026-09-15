import { type RenderBlock } from "@codewide/renderers";
import { type TurnUsageProjection } from "@codewide/sync-client";
import type { ReactNode } from "react";
import { View } from "react-native";
import { type TimelineItem } from "../timeline/timelineTypes";

/** Inputs owned by this composition boundary; concrete state owners remain separate. */
export type TurnTimelineItemProps = {
  turn: Extract<TimelineItem, { kind: "turn" }>;
  agentDateLabel?: string | null;
  compact: boolean;
  animateLiveUpdates: boolean;
  usage?: TurnUsageProjection | null;
  forceExpanded?: boolean;
  requestPrompt: ReactNode;
  getTransferAccess?(): Promise<{ baseUrl: string; authorization: string }>;
  onFixUnsupportedBlock?(block: RenderBlock): Promise<void>;
  onForkThroughTurn?(turnId: string): Promise<void>;
  onLoadItems?(turnId: string): Promise<void>;
  latestAgentRef?(node: View | null): void;
  onLatestAgentLayout?(): void;
};
