import type { RenderBlock } from "@codewide/renderers";
import type { ReactNode } from "react";
import type { View } from "react-native";
import type { GetTransferAccess } from "../../../data/private-transfer";
import type { ThreadForkOptions } from "../../../data/thread-fork";
import type { TimelineTurnDateLabels } from "../../../presentation/conversation/timelineDates";
import type { SearchConversationWindow } from "../../search/search-conversation-window";
import type { TimelineItem } from "./timelineTypes";

/** Inputs owned by this composition boundary; concrete state owners remain separate. */
export type UseThreadTimelineProps = {
  animateLiveUpdates: boolean;
  composerScope: string;
  fixUnsupportedBlock: (block: RenderBlock) => Promise<void>;
  focusSearchMessage: (node: View) => void;
  forkThroughTurn: (turnId: string) => Promise<void>;
  getStableTransferAccess: GetTransferAccess;
  getTransferAccess: GetTransferAccess | undefined;
  latestUnreadAgentTurnId: string | null;
  loadStableTurnItems: (turnId: string) => Promise<void>;
  onFixUnsupportedBlock: ((block: RenderBlock) => Promise<void>) | undefined;
  onFork: ((options: ThreadForkOptions) => Promise<void>) | undefined;
  onLoadTurnItems: ((turnId: string) => Promise<void>) | undefined;
  onRetryFailedMessage: ((commandId: string) => Promise<void>) | undefined;
  openThreadDocumentLink: (href: string) => boolean;
  requestPrompt: ReactNode;
  scheduleUnreadAgentVisibilityCheck: () => void;
  searchWindow: SearchConversationWindow | null;
  setLatestUnreadAgentNode: (node: View | null) => void;
  threadSearchActive: boolean;
  timelineCompact: boolean;
  timelineDateLabels: ReadonlyMap<TimelineItem, TimelineTurnDateLabels>;
};
