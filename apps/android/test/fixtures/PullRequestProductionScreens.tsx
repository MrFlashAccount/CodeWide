import { Text, View } from "react-native";

import type { WorkspacePaneChrome } from "../../src/routeComposition/workspacePanes";
import { PaneChromeControls } from "./PaneChromeControls";

const pullRequestModel = { get: () => ({}) };

/** The canonical review chat the production overview names; `null` while the PR has none. */
export const productionReviewThread: {
  current: { readonly threadId: string; readonly title: string } | null;
} = { current: null };

export function ProductionPullRequestOverview(): React.JSX.Element {
  return <View testID="production-pr-overview" />;
}

export function useProductionPullRequestScreen() {
  return {
    activity: { items: [], nextCursor: null },
    agentThread: productionReviewThread.current,
    draftCount: 0,
    listRow: null,
    loadMoreActivity: null,
    model: pullRequestModel,
    offline: false,
    overview: {
      account: { host: "github.example", login: "reviewer", pluginId: "github" },
      author: "author",
      headRevision: "revision",
      links: [],
      webUrl: "https://github.example/pull/91",
    },
    params: { connectionId: "server", pullRequest: "fpr1.github-91" },
    setRowWidth: jest.fn(),
    slots: { anchored: { files: [] }, overflow: [], verdicts: [] },
  };
}

export function ProductionPullRequestConversation({
  chrome,
  threadId,
}: {
  readonly chrome: WorkspacePaneChrome;
  readonly threadId: string;
}): React.JSX.Element {
  return (
    <View testID="production-canonical-conversation">
      <Text>{threadId}</Text>
      <PaneChromeControls chrome={chrome} name="review chat" />
    </View>
  );
}

export function ProductionPullRequestDraft({
  chrome,
}: {
  readonly chrome: WorkspacePaneChrome;
}): React.JSX.Element {
  return (
    <View testID="production-review-chat-draft">
      <PaneChromeControls chrome={chrome} name="review chat" />
    </View>
  );
}
