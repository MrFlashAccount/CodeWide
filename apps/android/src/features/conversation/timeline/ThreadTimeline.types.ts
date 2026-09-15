import { type RenderBlock } from "@codewide/renderers";
import type { ReactNode } from "react";
import { View } from "react-native";
import { type GetTransferAccess } from "../../../data/private-transfer";
import type { ThreadForkOptions } from "../../../data/thread-fork";
import { type TimelineTurnDateLabels } from "../../../presentation/conversation/timelineDates";
import { SearchConversationWindow } from "../../search/search-conversation-window";
import { type TimelineItem } from "./timelineTypes";

/** Inputs owned by this composition boundary; concrete state owners remain separate. */
export type UseThreadTimelineProps = {
  fixUnsupportedBlock: (block: RenderBlock) => Promise<void>;
  forkThroughTurn: (turnId: string) => Promise<void>;
  loadStableTurnItems: (turnId: string) => Promise<void>;
  onFixUnsupportedBlock: ((block: RenderBlock) => Promise<void>) | undefined;
  onFork: ((options: ThreadForkOptions) => Promise<void>) | undefined;
  onLoadTurnItems: ((turnId: string) => Promise<void>) | undefined;
  timelineDateLabels: ReadonlyMap<TimelineItem, TimelineTurnDateLabels>;
  searchWindow: SearchConversationWindow | null;
  focusSearchMessage: (node: View) => void;
  openThreadDocumentLink: (href: string) => boolean;
  composerScope: string;
  getTransferAccess: GetTransferAccess | undefined;
  getStableTransferAccess: GetTransferAccess;
  timelineCompact: boolean;
  animateLiveUpdates: boolean;
  threadSearchActive: boolean;
  requestPrompt: ReactNode;
  latestUnreadAgentTurnId: string | null;
  setLatestUnreadAgentNode: (node: View | null) => void;
  scheduleUnreadAgentVisibilityCheck: () => void;
  onRetryFailedMessage: ((commandId: string) => Promise<void>) | undefined;
};
