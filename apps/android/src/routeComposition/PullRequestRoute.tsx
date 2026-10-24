import { Ionicons } from "@expo/vector-icons";
import { useLocalSearchParams, useRouter } from "expo-router";
import { Suspense, useLayoutEffect, useState, type ComponentProps } from "react";
import { Pressable, StyleSheet, View } from "react-native";
import Reanimated, { LinearTransition } from "react-native-reanimated";

import { parsePullRequestKeyParam } from "../data/forgeContract";
import {
  forgeResources,
  pullRequestCommentDestinations,
  reviewResources,
} from "../data/forgeRuntime";
import type { ThreadId } from "../data/reviewContract";
import { PullRequestScreen } from "../features/pullRequestDetail/PullRequestScreen";
import { PullRequestScreenSkeleton } from "../features/pullRequestDetail/PullRequestScreenSkeleton";
import type { PullRequestScreenProps } from "../features/pullRequestDetail/pullRequestScreenContract";
import { workspaceFeatures } from "../features/workspace/createWorkspaceFeatures";
import { desktopThreadSidebarWidth } from "../presentation/layouts/windowLayout";
import { useEvent } from "../react/useEvent";
import { useWorkspaceRouteResources } from "../services/workspace/workspaceRouteResources";
import { colors, controlSize, iconSize, radii, spacing } from "../theme";
import { useAppFullscreenOverlay } from "../ui/AppFullscreenOverlay";
import { RecoverableRenderBoundary } from "../ui/RecoverableRenderBoundary";
import { useLinkedThreadDescriptions } from "./linkedThreadDescriptions";
import { PullRequestConversationPane } from "./PullRequestConversationPane";
import { linkedThreadSelectionKey } from "./pullRequestNavigation";
import { useWorkspacePaneController } from "./workspacePaneController";

type ChatPaneState =
  | { readonly status: "closed" }
  | { readonly status: "opening" }
  | { readonly status: "open"; readonly threadId: ThreadId };

const CHAT_EXPANDED_MAX_WIDTH = 640;
const THREE_PANE_MIN_WIDTH = 1200;
const PANE_TRANSITION_DURATION_MS = 220;
const EXPANDED_CHAT_VIEWPORT_DIVISOR = 2;
const CHAT_SKELETON_BUBBLE_HEIGHT = 72;
const CHAT_SKELETON_LONG_BUBBLE_HEIGHT = 104;
const CHAT_SKELETON_TITLE_HEIGHT = 18;
const PANE_TRANSITION = LinearTransition.duration(PANE_TRANSITION_DURATION_MS);

/** PR destination with adaptive PR/chat pane geometry. */
export function PullRequestRoute(): React.JSX.Element | null {
  const params = useLocalSearchParams<{ connectionId?: string; pullRequestKey?: string }>();
  const router = useRouter();
  const overlay = useAppFullscreenOverlay({ scope: "pull-request-workspace" });
  const paneController = useWorkspacePaneController();
  const { desktop, list, viewportWidth } = useWorkspaceRouteResources();
  const [chat, setChat] = useState<ChatPaneState>({ status: "closed" });
  const [chatExpanded, setChatExpanded] = useState(false);
  const describeThread = useLinkedThreadDescriptions(list.loadedThreadSummaries);
  const connectionId = typeof params.connectionId === "string" ? params.connectionId : null;
  const pullRequest = parsePullRequestKeyParam(params.pullRequestKey);
  const back = useEvent((): void => {
    if (router.canGoBack()) {
      router.back();
    } else {
      router.replace("/pulls");
    }
  });
  const setCatalogClaimed = useEvent((claimed: boolean): void => {
    paneController.setDetailExpanded(claimed && desktop && viewportWidth < THREE_PANE_MIN_WIDTH);
  });
  const beginChat = useEvent((): void => {
    setChat((current) => (current.status === "closed" ? { status: "opening" } : current));
    if (desktop) {
      setCatalogClaimed(true);
    }
  });
  const closeChat = useEvent((): void => {
    setChat({ status: "closed" });
    setChatExpanded(false);
    setCatalogClaimed(false);
  });
  const openThread = useEvent((threadId: ThreadId): void => {
    if (connectionId === null) {
      return;
    }
    if (desktop) {
      setChat({ status: "open", threadId });
      setCatalogClaimed(true);
    } else {
      setChat({ status: "closed" });
      list.selectThread(linkedThreadSelectionKey(connectionId, threadId));
    }
  });
  const toggleChatExpanded = useEvent((): void => {
    setChatExpanded((expanded) => !expanded);
  });
  const openPullRequestFullscreen = useEvent((): void => {
    if (connectionId === null || pullRequest === null) {
      return;
    }
    overlay.present(({ close }) => (
      <FullscreenPullRequestDetail
        beginChat={beginChat}
        close={close}
        connectionId={connectionId}
        describeThread={(threadId) => describeThread(connectionId, threadId)}
        openThread={openThread}
        pullRequest={pullRequest}
      />
    ));
  });
  const openChatFullscreen = useEvent((threadId: ThreadId): void => {
    if (connectionId === null) {
      return;
    }
    overlay.present(({ close }) => (
      <PullRequestConversationPane
        connectionId={connectionId}
        headerActions={<FullscreenCloseButton onPress={close} />}
        onClose={close}
        threadId={threadId}
      />
    ));
  });
  useLayoutEffect(
    () => () => {
      paneController.setDetailExpanded(false);
    },
    [paneController],
  );
  if (connectionId === null || pullRequest === null) {
    return null;
  }

  const navigation: PullRequestScreenProps["navigation"] = {
    back,
    beginChat,
    chatVisible: chat.status !== "closed",
    closeChat,
    openPullRequestFullscreen,
    openThread,
    pullRequestFullscreen: false,
  };

  return (
    <RecoverableRenderBoundary
      label="Pull request"
      resetKey={`${connectionId}:${pullRequest}`}
      scope="surface"
    >
      <View style={styles.workspace} testID="pull-request-workspace">
        <PullRequestPrimaryPane
          connectionId={connectionId}
          describeThread={(threadId) => describeThread(connectionId, threadId)}
          desktop={desktop}
          navigation={navigation}
          pullRequest={pullRequest}
        />
        <PullRequestChatDestination
          chat={chat}
          connectionId={connectionId}
          desktop={desktop}
          expanded={chatExpanded}
          onClose={closeChat}
          onFullscreen={openChatFullscreen}
          onToggleExpanded={toggleChatExpanded}
          viewportWidth={viewportWidth}
        />
      </View>
    </RecoverableRenderBoundary>
  );
}

function FullscreenPullRequestDetail({
  beginChat,
  close,
  connectionId,
  describeThread,
  openThread,
  pullRequest,
}: {
  readonly beginChat: () => void;
  readonly close: () => void;
  readonly connectionId: string;
  readonly describeThread: PullRequestScreenProps["describeThread"];
  readonly openThread: (threadId: ThreadId) => void;
  readonly pullRequest: PullRequestScreenProps["pullRequest"];
}): React.JSX.Element {
  const leaveForChat = useEvent((): void => {
    close();
    beginChat();
  });
  const leaveForThread = useEvent((threadId: ThreadId): void => {
    close();
    openThread(threadId);
  });
  return (
    <PullRequestDetailSurface
      connectionId={connectionId}
      describeThread={describeThread}
      desktop
      navigation={{
        back: close,
        beginChat: leaveForChat,
        chatVisible: false,
        closeChat: close,
        openPullRequestFullscreen: close,
        openThread: leaveForThread,
        pullRequestFullscreen: true,
      }}
      pullRequest={pullRequest}
    />
  );
}

function PullRequestChatDestination({
  chat,
  connectionId,
  desktop,
  expanded,
  onClose,
  onFullscreen,
  onToggleExpanded,
  viewportWidth,
}: {
  readonly chat: ChatPaneState;
  readonly connectionId: string;
  readonly desktop: boolean;
  readonly expanded: boolean;
  readonly onClose: () => void;
  readonly onFullscreen: (threadId: ThreadId) => void;
  readonly onToggleExpanded: () => void;
  readonly viewportWidth: number;
}): React.JSX.Element | null {
  if (desktop) {
    return (
      <LinkedConversationSidebar
        chat={chat}
        connectionId={connectionId}
        expanded={expanded}
        onClose={onClose}
        onFullscreen={onFullscreen}
        onToggleExpanded={onToggleExpanded}
        viewportWidth={viewportWidth}
      />
    );
  }
  if (chat.status !== "opening") {
    return null;
  }
  return (
    <View style={styles.compactChatOpening}>
      <ChatOpeningSkeleton onClose={onClose} />
    </View>
  );
}

function PullRequestPrimaryPane(props: PullRequestDetailSurfaceProps): React.JSX.Element {
  return (
    <Reanimated.View
      layout={PANE_TRANSITION}
      style={styles.pullRequest}
      testID="pull-request-primary-pane"
    >
      <PullRequestDetailSurface {...props} />
    </Reanimated.View>
  );
}

type PullRequestDetailSurfaceProps = {
  readonly connectionId: string;
  readonly describeThread: PullRequestScreenProps["describeThread"];
  readonly desktop: boolean;
  readonly navigation: PullRequestScreenProps["navigation"];
  readonly pullRequest: PullRequestScreenProps["pullRequest"];
};

function PullRequestDetailSurface(props: PullRequestDetailSurfaceProps): React.JSX.Element {
  return (
    <Suspense fallback={<PullRequestScreenSkeleton />}>
      <PullRequestScreen
        capabilities={workspaceFeatures.pullRequestDetail}
        commentDestinations={pullRequestCommentDestinations}
        connectionId={props.connectionId}
        describeThread={props.describeThread}
        forge={forgeResources}
        navigation={props.navigation}
        pullRequest={props.pullRequest}
        review={reviewResources}
        reviewCapabilities={workspaceFeatures.reviewTarget}
        tablet={props.desktop}
      />
    </Suspense>
  );
}

function LinkedConversationSidebar({
  chat,
  connectionId,
  expanded,
  onClose,
  onFullscreen,
  onToggleExpanded,
  viewportWidth,
}: {
  readonly chat: ChatPaneState;
  readonly connectionId: string;
  readonly expanded: boolean;
  readonly onClose: () => void;
  readonly onFullscreen: (threadId: ThreadId) => void;
  readonly onToggleExpanded: () => void;
  readonly viewportWidth: number;
}): React.JSX.Element | null {
  if (chat.status === "closed") {
    return null;
  }
  const width = expanded
    ? Math.min(CHAT_EXPANDED_MAX_WIDTH, Math.floor(viewportWidth / EXPANDED_CHAT_VIEWPORT_DIVISOR))
    : desktopThreadSidebarWidth(viewportWidth);
  return (
    <Reanimated.View
      layout={PANE_TRANSITION}
      style={[styles.chat, { width }]}
      testID="pull-request-chat-pane"
    >
      {chat.status === "opening" ? (
        <ChatOpeningSkeleton onClose={onClose} />
      ) : (
        <PullRequestConversationPane
          connectionId={connectionId}
          headerActions={
            <ChatPaneActions
              expanded={expanded}
              onClose={onClose}
              onFullscreen={() => {
                onFullscreen(chat.threadId);
              }}
              onToggleExpanded={onToggleExpanded}
            />
          }
          onClose={onClose}
          threadId={chat.threadId}
        />
      )}
    </Reanimated.View>
  );
}

function ChatPaneActions({
  expanded,
  onClose,
  onFullscreen,
  onToggleExpanded,
}: {
  readonly expanded: boolean;
  readonly onClose: () => void;
  readonly onFullscreen: () => void;
  readonly onToggleExpanded: () => void;
}): React.JSX.Element {
  return (
    <View style={styles.chatActions}>
      <HeaderIcon
        label={expanded ? "Narrow review chat" : "Widen review chat"}
        name={expanded ? "contract-outline" : "resize-outline"}
        onPress={onToggleExpanded}
      />
      <HeaderIcon
        label="Open review chat fullscreen"
        name="expand-outline"
        onPress={onFullscreen}
      />
      <HeaderIcon label="Close review chat" name="close" onPress={onClose} />
    </View>
  );
}

function FullscreenCloseButton({ onPress }: { readonly onPress: () => void }): React.JSX.Element {
  return <HeaderIcon label="Exit fullscreen" name="contract-outline" onPress={onPress} />;
}

function HeaderIcon({
  label,
  name,
  onPress,
}: {
  readonly label: string;
  readonly name: ComponentProps<typeof Ionicons>["name"];
  readonly onPress: () => void;
}): React.JSX.Element {
  return (
    <Pressable
      accessibilityLabel={label}
      accessibilityRole="button"
      onPress={onPress}
      style={styles.icon}
    >
      <Ionicons color={colors.text} name={name} size={iconSize.action} />
    </Pressable>
  );
}

function ChatOpeningSkeleton({ onClose }: { readonly onClose: () => void }): React.JSX.Element {
  return (
    <View
      accessibilityLabel="Opening review chat"
      accessibilityState={{ busy: true }}
      style={styles.chatLoading}
      testID="pull-request-chat-opening"
    >
      <View style={styles.chatLoadingHeader}>
        <View style={styles.chatLoadingTitle} />
        <HeaderIcon label="Cancel opening review chat" name="close" onPress={onClose} />
      </View>
      <View style={styles.chatLoadingBubble} />
      <View style={[styles.chatLoadingBubble, styles.chatLoadingBubbleShort]} />
      <View style={styles.chatLoadingComposer} />
    </View>
  );
}

const styles = StyleSheet.create({
  chat: {
    borderLeftColor: colors.borderSoft,
    borderLeftWidth: StyleSheet.hairlineWidth,
    minWidth: 0,
  },
  chatActions: {
    alignItems: "center",
    flexDirection: "row",
  },
  chatLoading: {
    backgroundColor: colors.conversationSurface,
    flex: 1,
    gap: spacing.md,
    padding: spacing.md,
  },
  chatLoadingBubble: {
    alignSelf: "flex-end",
    backgroundColor: colors.surfaceContainer,
    borderRadius: radii.bubble,
    height: CHAT_SKELETON_BUBBLE_HEIGHT,
    width: "78%",
  },
  chatLoadingBubbleShort: {
    alignSelf: "flex-start",
    height: CHAT_SKELETON_LONG_BUBBLE_HEIGHT,
    width: "68%",
  },
  chatLoadingComposer: {
    backgroundColor: colors.surfaceContainerHigh,
    borderRadius: radii.composer,
    height: controlSize.touch,
    marginTop: "auto",
  },
  chatLoadingHeader: {
    alignItems: "center",
    flexDirection: "row",
  },
  chatLoadingTitle: {
    backgroundColor: colors.surfaceContainerHigh,
    borderRadius: radii.compact,
    flex: 1,
    height: CHAT_SKELETON_TITLE_HEIGHT,
  },
  compactChatOpening: {
    bottom: 0,
    left: 0,
    position: "absolute",
    right: 0,
    top: 0,
    zIndex: 1,
  },
  icon: {
    alignItems: "center",
    height: controlSize.touch,
    justifyContent: "center",
    width: controlSize.touch,
  },
  pullRequest: {
    flex: 1,
    minWidth: 0,
  },
  workspace: {
    flex: 1,
    flexDirection: "row",
    minWidth: 0,
  },
});
