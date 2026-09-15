import type { ReactNode } from "react";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import type { useComposerCommands } from "../composer/composerCommands";
import type { useComposerState } from "../composer/composerState";
import type { ComposerWorkspaceCapabilities } from "../composer/composerWorkspaceCapabilities";
import { useComposerProjectSelection } from "../projects/composerProjectSelection";
import type { ProjectConversationCapabilities } from "../projects/projectConversationCapabilities";
import { projectInlineQueue } from "../queue/QueueFeature";
import { useQueueVisibility } from "../queue/queueVisibility";
import type { QueueWorkspaceCapabilities } from "../queue/queueWorkspaceCapabilities";
import { useWindowLayout } from "../workspace/useWindowLayout";
import type { ConversationSurfaceCapabilities } from "./conversationSurfaceCapabilities";
import type { MainThreadReadCapabilities } from "./mainThreadReadCapabilities";
import { useConversationTimelineRead } from "./timeline/conversationTimelineRead";
import { useConversationTimelineState } from "./timeline/conversationTimelineState";
import { useOverlayScrollState } from "./timeline/overlayScrollOwnership";
import { useThreadTimeline } from "./timeline/ThreadTimeline";
import { usePaginationTrim } from "./timeline/timelineViewport";

/** Inputs owned by this composition boundary; concrete state owners remain separate. */
export type CreateConversationTimelineContentProps = {
  composerScope: string;
  timelineState: ReturnType<typeof useConversationTimelineState>;
  timelineRead: ReturnType<typeof useConversationTimelineRead>;
  windowLayout: ReturnType<typeof useWindowLayout>;
  timelineCompact: boolean;
  liveStatusVisible: boolean;
  conversationInsets: ReturnType<typeof useSafeAreaInsets>;
  overlayScrollStateBinding: ReturnType<typeof useOverlayScrollState>;
  historyViewport: Exclude<MainThreadReadCapabilities["historyViewport"], undefined>;
  queueVisibilityBinding: ReturnType<typeof useQueueVisibility>;
  draftConnectionId: string | null;
  draftThreadId: string | null;
  paginationTrimBinding: ReturnType<typeof usePaginationTrim>;
  threadTimelineBinding: ReturnType<typeof useThreadTimeline>;
  cwd: Exclude<ConversationSurfaceCapabilities["cwd"], undefined>;
  composerProjectSelectionBinding: ReturnType<typeof useComposerProjectSelection>;
  workspaceSupport: Exclude<ProjectConversationCapabilities["workspaceSupport"], undefined>;
  projectsInputs: ProjectConversationCapabilities;
  workspaceMode: Exclude<ProjectConversationCapabilities["workspaceMode"], undefined>;
  historyActivityModel: Exclude<MainThreadReadCapabilities["historyActivityModel"], undefined>;
  historyActivityResourceId: Exclude<
    MainThreadReadCapabilities["historyActivityResourceId"],
    undefined
  >;
  composerStateBinding: ReturnType<typeof useComposerState>;
  inlineQueueBinding: ReturnType<typeof projectInlineQueue>;
  inlineQueueMaxHeight: number;
  queueInputs: QueueWorkspaceCapabilities;
  visibleQueuedPrompts: Exclude<QueueWorkspaceCapabilities["queuedPrompts"], undefined>;
  queueEditActionsBinding: ReturnType<typeof useComposerCommands>["queueEditActionsBinding"];
  composerInputs: ComposerWorkspaceCapabilities;
  readOnly: Exclude<ConversationSurfaceCapabilities["readOnly"], undefined>;
  messageListState: Exclude<MainThreadReadCapabilities["messageListState"], undefined>;
  readInputs: MainThreadReadCapabilities;
  goalContent: ReactNode;
};
