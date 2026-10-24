import { useSelector } from "@legendapp/state/react";
import { Ionicons } from "@expo/vector-icons";
import { Pressable, StyleSheet, View } from "react-native";

import type { ActionDescriptor } from "../../data/forgeActionCatalog";
import { remoteValue } from "../../data/forgeRemoteValue";
import { useForgeQuery } from "../../data/forgeQueryResource";
import { useMinuteClock } from "../../data/minuteClock";
import { useEvent } from "../../react/useEvent";
import { colors, controlSize, iconSize, radii, spacing } from "../../theme";
import { useAppDialog } from "../../ui/AppDialog";
import { ExtensionInputSheet } from "./actions/ExtensionInputSheet";
import { openOnForge } from "./actions/openOnForge";
import { usePullRequestActions } from "./actions/usePullRequestActions";
import { PullRequestChanges } from "./changes/PullRequestChanges";
import { OverviewPane } from "./OverviewPane";
import { PullRequestAppBar } from "./PullRequestAppBar";
import type { PullRequestScreenProps } from "./pullRequestScreenContract";
import { PullRequestTabs } from "./PullRequestTabs";
import { threadTitle, usePullRequestScreen } from "./usePullRequestScreen";

/**
 * PR screen: app bar, Details | Changes work surfaces and an intent that opens
 * the canonical linked conversation in route-owned geometry. Details suspends
 * behind the route-owned skeleton; files, drafts and the guide fill in
 * progressively below it. Offline, every forge write is refused locally.
 */
export function PullRequestScreen(props: PullRequestScreenProps): React.JSX.Element {
  const data = usePullRequestScreen(props);
  const { model, overview, params } = data;
  const dialog = useAppDialog();
  const nowMs = useMinuteClock();
  const state = useSelector(() => model.get());
  const host = overview.account.host;
  const refresh = useEvent((): void => {
    props.forge.overviews.refresh(params).catch(() => undefined);
  });
  const actions = usePullRequestActions({
    capabilities: props.capabilities,
    describeThread: props.describeThread,
    links: overview.links,
    model,
    onOpenThread: props.navigation.openThread,
    onRefresh: refresh,
    target: { ...params, headRevision: overview.headRevision, host },
  });
  const run = useEvent((action: ActionDescriptor, input: boolean | string | null): void => {
    if (data.offline) {
      dialog.alert("The companion is offline", "Writes need an acknowledged companion request.");
    } else {
      actions.run(action, input);
    }
  });
  const openReviewChat = useEvent((): void => {
    props.navigation.beginChat();
    props.capabilities
      .ensureReviewChat({
        connectionId: props.connectionId,
        pullRequest: props.pullRequest,
      })
      .then(({ threadId }) => {
        props.navigation.openThread(threadId);
      })
      .catch((error: unknown) => {
        props.navigation.closeChat();
        dialog.error("Could not open the review chat", error);
      });
  });
  const extra = openOnForge(overview.webUrl, host);
  const icon = useProviderIcon(props, overview.account.pluginId);
  return (
    <View style={styles.screen} testID="pull-request-screen">
      <PullRequestAppBar
        extra={extra}
        fullscreen={props.navigation.pullRequestFullscreen}
        icon={icon}
        onBack={props.tablet ? null : props.navigation.back}
        onFullscreen={props.tablet ? props.navigation.openPullRequestFullscreen : null}
        onRun={(action) => {
          run(action, null);
        }}
        overflow={props.tab === "overview" ? [] : data.slots.overflow}
        overview={overview}
      />
      <PullRequestTabs
        draftCount={data.draftCount}
        onSelect={props.navigation.openTab}
        tab={props.tab}
      />
      {props.tab === "overview" ? (
        <OverviewPane
          data={data}
          extra={extra}
          nowMs={nowMs}
          onOpenReviewChat={openReviewChat}
          onRun={run}
          props={props}
          state={state}
        />
      ) : (
        <PullRequestChanges
          agentThread={data.agentThread}
          capabilities={props.capabilities}
          commentDestinations={props.commentDestinations}
          connectionId={props.connectionId}
          describeThread={(threadId) => threadTitle(props.describeThread, threadId)}
          fileActions={data.slots.anchored.files}
          forge={props.forge}
          host={host}
          model={model}
          nowMs={nowMs}
          offline={data.offline}
          onRun={(action) => {
            run(action, null);
          }}
          onStale={(kind) => {
            model.notice.set({ kind });
            refresh();
          }}
          overview={overview}
          ownPullRequest={overview.author === overview.account.login}
          review={props.review}
          reviewCapabilities={props.reviewCapabilities}
          tablet={props.tablet}
          verdicts={data.slots.verdicts}
        />
      )}
      {actions.pendingInput === null ? null : (
        <ExtensionInputSheet
          action={actions.pendingInput}
          onDismiss={actions.dismissInput}
          onSubmit={actions.submitInput}
        />
      )}
      {props.navigation.chatVisible ? null : (
        <LinkedChatButton
          aboveReviewDock={props.tab === "changes"}
          disabled={false}
          label={
            data.agentThread === null
              ? "Start linked review chat"
              : `Open linked review chat: ${data.agentThread.title}`
          }
          onPress={openReviewChat}
        />
      )}
    </View>
  );
}

/** Opens the PR's canonical ordinary conversation; the route owns its panel. */
function LinkedChatButton({
  aboveReviewDock,
  disabled,
  label,
  onPress,
}: {
  readonly aboveReviewDock: boolean;
  readonly disabled: boolean;
  readonly label: string;
  readonly onPress: () => void;
}): React.JSX.Element {
  return (
    <Pressable
      accessibilityLabel={label}
      accessibilityRole="button"
      accessibilityState={{ busy: disabled, disabled }}
      disabled={disabled}
      onPress={onPress}
      style={({ pressed }) => [
        styles.chatButton,
        aboveReviewDock ? styles.chatButtonAboveDock : styles.chatButtonAtEdge,
        (disabled || pressed) && styles.chatButtonMuted,
      ]}
      testID="pull-request-linked-chat"
    >
      <Ionicons color={colors.onPrimary} name="chatbubble-outline" size={iconSize.navigation} />
    </Pressable>
  );
}

/** Provider icon of the PR's account from the accounts resource, if loaded. */
function useProviderIcon(props: PullRequestScreenProps, pluginId: string) {
  // A cold deep link has no catalog behind it; the mark still comes from the accounts snapshot.
  const accounts = useForgeQuery(props.forge.accounts, { connectionId: props.connectionId });
  return (
    remoteValue(accounts)?.providers.find((candidate) => candidate.pluginId === pluginId)?.icon ??
    null
  );
}

/** Keeps the linked-chat action above the Changes review dock. */
const REVIEW_DOCK_CLEARANCE = 88;
const MUTED_CONTROL_OPACITY = 0.6;

const styles = StyleSheet.create({
  chatButton: {
    alignItems: "center",
    backgroundColor: colors.primary,
    borderRadius: radii.pill,
    height: controlSize.touch,
    justifyContent: "center",
    position: "absolute",
    right: spacing.md,
    width: controlSize.touch,
  },
  chatButtonAboveDock: {
    bottom: REVIEW_DOCK_CLEARANCE,
  },
  chatButtonAtEdge: {
    bottom: spacing.lg,
  },
  chatButtonMuted: {
    opacity: MUTED_CONTROL_OPACITY,
  },
  screen: {
    backgroundColor: colors.conversationSurface,
    flex: 1,
  },
});
