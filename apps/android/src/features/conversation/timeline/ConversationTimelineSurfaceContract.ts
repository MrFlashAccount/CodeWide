import type { LiveTurnPlan } from "../../../rendering/live-turn-plan";
import type { ReactElement, ReactNode } from "react";
import type { TimelineItem } from "./timelineTypes";
import type { Thread } from "@codewide/codex-protocol/v0.155.1/v2";
import type { RefObject } from "react";
import type { View } from "react-native";
import type { ThreadHistoryModel } from "../../../data/thread-history-model";
import type { ThreadHistoryViewport } from "../../../data/use-thread-history-controller";
import type { MessageListState } from "../../../ui/MessageListBoundary";

/** State and actions required by the complete conversation timeline surface. */
export type ConversationTimelineSurfaceProps = {
  awayFromLatest: boolean;
  bottomChromeHeight: number;
  commitUnreadReceipt: () => () => void;
  composerScope: string;
  draftConnectionId: string | null;
  draftThreadId: string | null;
  fullscreenCovered: boolean;
  goalContent: ReactNode;
  historyActivityModel: ThreadHistoryModel | null;
  historyActivityResourceId: string | null;
  historyViewport: ThreadHistoryViewport;
  latestUnreadReceiptKey: string | null;
  liveStatusVisible: boolean;
  liveTurnPlan: LiveTurnPlan | null;
  messageListState: MessageListState;
  positionSearchTurn: () => void;
  readOnly: boolean;
  remoteThread: Thread | null | undefined;
  threadSearchActive: boolean;
  timeline: TimelineItem[];
  timelineContent: ReactElement;
  timelineDidLoad: boolean;
  timelineGestureActive: boolean;
  timelineModelReady: boolean;
  timelinePositioned: boolean;
  timelineViewportRef: RefObject<View | null>;
};
