/**
 * Browser preview of the real Pull requests surfaces over the fake companion
 * in `previewCompanion.ts`. It drives the actual data resources, feature
 * adapters and components; only the transport is fake. Used by
 * `pull-requests-preview.browser.test.mjs` for layout checks and captures.
 */
import { useSelector } from "@legendapp/state/react";
import { Suspense, useState } from "react";
import { createRoot } from "react-dom/client";
import { StyleSheet, View } from "react-native";
import { SafeAreaProvider } from "react-native-safe-area-context";

import { parsePullRequestKeyParam } from "../../src/data/forgeContract";
import { PullRequestScreen } from "../../src/features/pullRequestDetail/PullRequestScreen";
import { createPullRequestDetailWorkspaceAdapter } from "../../src/features/pullRequestDetail/workspaceAdapter";
import { CatalogModeBar } from "../../src/features/pullRequests/CatalogModeBar";
import { PullRequestsCatalog } from "../../src/features/pullRequests/PullRequestsFeature";
import { ReviewInboxIllustration } from "../../src/features/pullRequests/onboarding/ReviewInboxIllustration";
import { openForgeAccounts } from "../../src/features/pullRequests/pullRequestListModel";
import { createPullRequestsWorkspaceAdapter } from "../../src/features/pullRequests/workspaceAdapter";
import {
  catalogModeBarBottomInset,
  catalogModeBarHorizontalInset,
} from "../../src/presentation/layouts/catalogModeBarGeometry";
import { createReviewTargetAdapter } from "../../src/features/review/reviewTargetAdapter";
import { styles as threadRowStyles } from "../../src/features/threadList/ThreadRow.styles";
import { ThreadRowContent } from "../../src/features/threadList/ThreadRowContent";
import { colors } from "../../src/theme";
import { AppDialogProvider } from "../../src/ui/AppDialog";
import { overview91 } from "./forgeWireFixtures";
import {
  authority,
  forgeResources as forge,
  pullRequestCommentDestinations,
  previewReady,
  reviewResources as review,
  scenario,
} from "./previewCompanion";

const pullRequests = createPullRequestsWorkspaceAdapter({ ...authority, forge });
const detail = createPullRequestDetailWorkspaceAdapter({
  ...authority,
  forge,
  reportDroppedAction: () => undefined,
  review,
  // The preview has no companion media path; inline images need none.
  transferAccess: async () => Promise.reject(new Error("The preview has no media access")),
});
const reviewTarget = createReviewTargetAdapter({
  ...authority,
  mutations: forge.mutations,
  resources: review,
});
const pullRequest = parsePullRequestKeyParam(overview91.pullRequest);
const threads: Readonly<Record<string, { readonly status: string; readonly title: string }>> = {
  "thread-forge-auth": { status: "Working", title: "Forge auth state" },
  "thread-review-91": { status: "Idle", title: "Review #91" },
};

if (scenario === "accounts") {
  openForgeAccounts();
}
/** The bottom bar uses the same count-free labels as the app. */
function ModeBar(): React.JSX.Element {
  return (
    <View pointerEvents="box-none" style={previewStyles.modeBar}>
      <CatalogModeBar mode="pullRequests" onSelect={() => undefined} />
    </View>
  );
}

function Catalog(): React.JSX.Element {
  return (
    <View style={previewStyles.catalog}>
      <PullRequestsCatalog
        capabilities={pullRequests}
        connectionId="server"
        forge={forge}
        onOpenPullRequest={() => undefined}
      />
      <ModeBar />
    </View>
  );
}

const previewStyles = StyleSheet.create({
  catalog: {
    backgroundColor: colors.threadListSurface,
    flex: 1,
  },
  catalogPane: {
    borderRightColor: colors.borderSoft,
    borderRightWidth: StyleSheet.hairlineWidth,
    width: 348,
  },
  modeBar: {
    bottom: catalogModeBarBottomInset,
    left: catalogModeBarHorizontalInset,
    position: "absolute",
    right: catalogModeBarHorizontalInset,
  },
  previewPane: {
    alignItems: "center",
    backgroundColor: colors.conversationSurface,
    flex: 1,
    justifyContent: "center",
    padding: 48,
  },
  twoPane: {
    flex: 1,
    flexDirection: "row",
  },
});

/** Thread rows with PR badges: one linked PR, two linked PRs (`+1`), and none. */
function ThreadRows(): React.JSX.Element {
  const rows = [
    {
      id: "thread-forge-auth",
      preview: "Mapped token expiry to AuthRequired in both plugins",
      time: "12m",
      title: "Forge auth state",
    },
    {
      id: "thread-arc-review",
      preview: "Waiting for the arc CI rerun",
      time: "1h",
      title: "Arcanum review fixes",
    },
    {
      id: "thread-plain",
      preview: "No pull request linked to this thread",
      time: "2h",
      title: "Release notes",
    },
  ];
  return (
    <View style={{ backgroundColor: colors.threadListSurface, flex: 1, paddingTop: 8 }}>
      {rows.map((row) => (
        <View key={row.id} style={threadRowStyles.threadRow}>
          <ThreadRowContent
            selected={false}
            server={undefined}
            thread={{ ...row, pinned: false, serverId: "server", unread: 0 }}
          />
        </View>
      ))}
    </View>
  );
}

function Screen({ tablet }: { readonly tablet: boolean }): React.JSX.Element | null {
  const [tab, setTab] = useState<"changes" | "overview">("overview");
  if (pullRequest === null) {
    return null;
  }
  return (
    <Suspense fallback={<View style={{ backgroundColor: colors.conversationSurface, flex: 1 }} />}>
      <PullRequestScreen
        capabilities={detail}
        commentDestinations={pullRequestCommentDestinations}
        connectionId="server"
        describeThread={(threadId) => threads[threadId] ?? null}
        forge={forge}
        isThreadUnread={() => false}
        navigation={{
          back: tablet ? null : () => undefined,
          deferReviewChatScenario: async () => Promise.resolve(null),
          openReviewChat: () => undefined,
          closeChanges: () => {
            setTab("overview");
          },
          openChanges: () => {
            setTab("changes");
          },
          openThread: () => undefined,
        }}
        pullRequest={pullRequest}
        review={review}
        reviewCapabilities={reviewTarget}
        initialChangesView="files"
        tab={tab}
        tablet={tablet}
      />
    </Suspense>
  );
}

const SCREEN_SCENARIOS = new Set(["checks-unavailable", "conflict", "submit-ok"]);

function Preview(): React.JSX.Element {
  const twoPane = window.innerWidth >= 720;
  if (scenario === "thread-badge") {
    return <ThreadRows />;
  }
  if (!scenario.startsWith("pr") && !SCREEN_SCENARIOS.has(scenario)) {
    return twoPane ? (
      <View style={previewStyles.twoPane}>
        <View style={previewStyles.catalogPane}>
          <Catalog />
        </View>
        <View style={previewStyles.previewPane}>
          <ReviewInboxIllustration />
        </View>
      </View>
    ) : (
      <Catalog />
    );
  }
  return twoPane ? (
    <View style={{ flex: 1, flexDirection: "row" }}>
      <View style={{ width: 320 }}>
        <Catalog />
      </View>
      <View style={{ flex: 1 }}>
        <Screen tablet />
      </View>
    </View>
  ) : (
    <Screen tablet={false} />
  );
}

const root = document.getElementById("app");
if (root !== null) {
  void previewReady.then(() => {
    createRoot(root).render(
      <SafeAreaProvider
        initialMetrics={{
          frame: { height: window.innerHeight, width: window.innerWidth, x: 0, y: 0 },
          insets: { bottom: 0, left: 0, right: 0, top: 0 },
        }}
      >
        <AppDialogProvider>
          <View
            style={{
              backgroundColor: colors.background,
              height: window.innerHeight,
              width: "100%",
            }}
          >
            <Preview />
          </View>
        </AppDialogProvider>
      </SafeAreaProvider>,
    );
  });
}
