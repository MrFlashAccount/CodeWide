import type { ReactNode } from "react";
import type { useSafeAreaInsets } from "react-native-safe-area-context";
import type { useComposerCommands } from "../composer/composerCommands";
import type { useComposerState } from "../composer/composerState";
import type { ComposerWorkspaceCapabilities } from "../composer/composerWorkspaceCapabilities";
import type { useComposerProjectSelection } from "../projects/composerProjectSelection";
import type { ProjectConversationCapabilities } from "../projects/projectConversationCapabilities";
import type { projectInlineQueue } from "../queue/QueueFeature";
import type { useQueueVisibility } from "../queue/queueVisibility";
import type { QueueWorkspaceCapabilities } from "../queue/queueWorkspaceCapabilities";
import type { useWindowLayout } from "../workspace/useWindowLayout";
import type { ConversationSurfaceCapabilities } from "./conversationSurfaceCapabilities";
import type { MainThreadReadCapabilities } from "./mainThreadReadCapabilities";
import type { useConversationTimelineRead } from "./timeline/conversationTimelineRead";
import type { useConversationTimelineState } from "./timeline/conversationTimelineState";
import type { useOverlayScrollState } from "./timeline/overlayScrollOwnership";
import type { useThreadTimeline } from "./timeline/ThreadTimeline";
import type { usePaginationTrim } from "./timeline/timelineViewport";

/** Inputs owned by this composition boundary; concrete state owners remain separate. */
export type CreateConversationTimelineContentProps = {
  composerInputs: ComposerWorkspaceCapabilities;
  composerProjectSelectionBinding: ReturnType<typeof useComposerProjectSelection>;
  composerScope: string;
  composerStateBinding: ReturnType<typeof useComposerState>;
  conversationInsets: ReturnType<typeof useSafeAreaInsets>;
  cwd: Exclude<ConversationSurfaceCapabilities["cwd"], undefined>;
  draftConnectionId: string | null;
  draftThreadId: string | null;
  goalContent: ReactNode;
  historyActivityModel: Exclude<MainThreadReadCapabilities["historyActivityModel"], undefined>;
  historyActivityResourceId: Exclude<
    MainThreadReadCapabilities["historyActivityResourceId"],
    undefined
  >;
  historyViewport: Exclude<MainThreadReadCapabilities["historyViewport"], undefined>;
  inlineQueueBinding: ReturnType<typeof projectInlineQueue>;
  inlineQueueMaxHeight: number;
  liveStatusVisible: boolean;
  messageListState: Exclude<MainThreadReadCapabilities["messageListState"], undefined>;
  overlayScrollStateBinding: ReturnType<typeof useOverlayScrollState>;
  paginationTrimBinding: ReturnType<typeof usePaginationTrim>;
  projectsInputs: ProjectConversationCapabilities;
  queueEditActionsBinding: ReturnType<typeof useComposerCommands>["queueEditActionsBinding"];
  queueInputs: QueueWorkspaceCapabilities;
  queueVisibilityBinding: ReturnType<typeof useQueueVisibility>;
  readInputs: MainThreadReadCapabilities;
  readOnly: Exclude<ConversationSurfaceCapabilities["readOnly"], undefined>;
  threadTimelineBinding: ReturnType<typeof useThreadTimeline>;
  timelineCompact: boolean;
  timelineRead: ReturnType<typeof useConversationTimelineRead>;
  timelineState: ReturnType<typeof useConversationTimelineState>;
  visibleQueuedPrompts: Exclude<QueueWorkspaceCapabilities["queuedPrompts"], undefined>;
  windowLayout: ReturnType<typeof useWindowLayout>;
  workspaceMode: Exclude<ProjectConversationCapabilities["workspaceMode"], undefined>;
  workspaceSupport: Exclude<ProjectConversationCapabilities["workspaceSupport"], undefined>;
};
