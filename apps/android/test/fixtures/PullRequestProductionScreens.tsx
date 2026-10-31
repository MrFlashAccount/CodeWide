import { Text, View } from "react-native";

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
    // The production overview is a stub, so it offers no floating Comment button.
    conversation: { status: "unsupported" },
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
    writes: { comment: jest.fn(), reply: jest.fn() },
  };
}

export function ProductionPullRequestConversation({
  threadId,
}: {
  readonly threadId: string;
}): React.JSX.Element {
  return (
    <View testID="production-canonical-conversation">
      <Text>{threadId}</Text>
      <PaneChromeControls name="review chat" />
    </View>
  );
}

export function ProductionPullRequestDraft(): React.JSX.Element {
  return (
    <View testID="production-review-chat-draft">
      <PaneChromeControls name="review chat" />
    </View>
  );
}
