import { LegendList } from "@legendapp/list/react-native";
import { act, fireEvent, render, within } from "@testing-library/react-native";
import { Animated, Dimensions, StyleSheet } from "react-native";
import { GestureDetector } from "react-native-gesture-handler";
import { SafeAreaProvider } from "react-native-safe-area-context";

import { parsePullRequestListPage } from "../src/data/forgePullRequestContract";
import { parseForgeAccounts } from "../src/data/forgeContract";
import { createForgeResources } from "../src/data/forgeResources";
import { PullRequestScreenSkeleton } from "../src/features/pullRequestDetail/PullRequestScreenSkeleton";
import { ActivitySection } from "../src/features/pullRequestDetail/overview/ActivitySection";
import { DescriptionSection } from "../src/features/pullRequestDetail/overview/DescriptionSection";
import { PullRequestFilterBar } from "../src/features/pullRequests/list/PullRequestFilterBar";
import { PullRequestFilterSheet } from "../src/features/pullRequests/list/PullRequestFilterSheet";
import { PullRequestList } from "../src/features/pullRequests/list/PullRequestList";
import { PullRequestsCatalog } from "../src/features/pullRequests/PullRequestsFeature";
import { PullRequestsHeader } from "../src/features/pullRequests/PullRequestsHeader";
import type { PullRequestsWorkspaceCapabilities } from "../src/features/pullRequests/workspaceCapabilities";
import {
  defaultPullRequestFilter,
  dismissPullRequestFilters,
  closePullRequestSearch,
  openPullRequestFilters,
  pullRequestFilterSheetModel,
  pullRequestListModel,
} from "../src/features/pullRequests/pullRequestListModel";
import {
  connectedAccount,
  githubProvider,
  reviewRequestedPage,
} from "./fixtures/forgeWireFixtures";
import { setKeyboardHeightForTest } from "./mocks/KeyboardController";
import { Tray } from "../src/vendor/reacticx/tray";
import { createMemoryQueryPersister } from "./fixtures/queryPersister";

jest.mock("../src/rendering/RichMarkdown", () => {
  const { Text } = jest.requireActual("react-native");
  return {
    RichMarkdown: ({ source }: { readonly source: string }) => (
      <Text testID="rich-markdown">{source}</Text>
    ),
  };
});

const originalWindow = Dimensions.get("window");

afterEach(() => {
  setKeyboardHeightForTest(0);
  Dimensions.set({ window: originalWindow });
  pullRequestListModel.set(defaultPullRequestFilter());
  dismissPullRequestFilters();
  closePullRequestSearch();
});

it("renders only search, sort and filters above the list", () => {
  const view = render(
    <PullRequestFilterBar
      filter={defaultPullRequestFilter()}
      onOpenFilters={() => undefined}
      onOpenSearch={() => undefined}
      onSort={() => undefined}
    />,
  );

  expect(view.getByLabelText("Search pull requests")).toBeVisible();
  expect(view.getByRole("button", { name: "Filters" })).toBeVisible();
  expect(view.queryByTestId("pull-request-quick-views")).toBeNull();
  expect(view.queryByTestId("pull-request-active-filters")).toBeNull();
});

it("opens pull-request search in the shared overlay without the sort action", () => {
  const page = parsePullRequestListPage(reviewRequestedPage);
  const accounts = parseForgeAccounts({
    accounts: [connectedAccount],
    flows: [],
    providers: [githubProvider],
  });
  if (page === null || accounts === null) {
    throw new Error("The pull-request fixture is invalid");
  }
  const forge = createForgeResources({
    getSession: () => undefined,
    persister: createMemoryQueryPersister().persister,
    reportDroppedAction: () => undefined,
    rpcAfterAttach: async <Result,>(): Promise<Result> => {
      throw new Error("Unexpected forge read");
    },
  });
  const filter = defaultPullRequestFilter();
  pullRequestListModel.set(filter);
  forge.accounts.publish({ connectionId: "server" }, accounts);
  forge.lists.publish({ connectionId: "server", filter }, page);
  const capabilities: PullRequestsWorkspaceCapabilities = {
    cancelAuth: () => Promise.resolve(),
    checkAgain: () => Promise.resolve(),
    disconnect: () => Promise.resolve(),
    setAccountEnabled: () => Promise.reject(new Error("Not used by this render test")),
    startAuth: () => Promise.reject(new Error("Not used by this render test")),
    submitToken: () => Promise.reject(new Error("Not used by this render test")),
  };
  const view = render(
    <SafeAreaProvider
      initialMetrics={{
        frame: { height: 800, width: 400, x: 0, y: 0 },
        insets: { bottom: 0, left: 0, right: 0, top: 0 },
      }}
    >
      <PullRequestsCatalog
        capabilities={capabilities}
        connectionId="server"
        forge={forge}
        isThreadUnread={() => false}
        onOpenPullRequest={() => undefined}
      />
    </SafeAreaProvider>,
  );

  fireEvent.press(view.getByLabelText("Search pull requests"));

  expect(view.getByTestId("pull-request-search-overlay")).toBeOnTheScreen();
  expect(view.getByTestId("pull-request-search-host")).toBeOnTheScreen();
  expect(view.queryByTestId("pull-requests-header")).toBeNull();
  expect(view.getByLabelText("Back to pull requests")).toBeOnTheScreen();
  expect(view.getByTestId("pull-request-search-input")).toBeOnTheScreen();
  expect(view.queryByLabelText("Sort pull requests")).toBeNull();
  expect(
    within(view.getByTestId("pull-request-search-overlay")).getByRole("button", {
      name: "Filters",
    }),
  ).toBeOnTheScreen();
  expect(
    view.getByTestId("pull-requests-header", { includeHiddenElements: true }),
  ).toBeOnTheScreen();
});

it("presents filters in a tray with a full-width primary action", () => {
  openPullRequestFilters();
  const view = render(
    <SafeAreaProvider
      initialMetrics={{
        frame: { height: 800, width: 400, x: 0, y: 0 },
        insets: { bottom: 0, left: 0, right: 0, top: 0 },
      }}
    >
      <PullRequestFilterSheet
        accounts={[connectedAccount]}
        providers={[githubProvider]}
        repositories={[]}
      />
    </SafeAreaProvider>,
  );

  expect(view.getByRole("button", { name: "Close" })).toBeOnTheScreen();
  expect(view.queryByTestId("pull-request-reset-filters")).toBeNull();
  expect(
    StyleSheet.flatten(view.getByRole("button", { name: "Apply filters" }).props.style),
  ).toMatchObject({
    alignItems: "center",
    width: "100%",
  });
});

it("bounds the filter tray to the viewport above the keyboard", () => {
  Dimensions.set({ window: { ...originalWindow, height: 800, width: 400 } });
  setKeyboardHeightForTest(300);
  openPullRequestFilters();
  const view = render(
    <SafeAreaProvider
      initialMetrics={{
        frame: { height: 800, width: 400, x: 0, y: 0 },
        insets: { bottom: 24, left: 0, right: 0, top: 24 },
      }}
    >
      <PullRequestFilterSheet
        accounts={[connectedAccount]}
        providers={[githubProvider]}
        repositories={[]}
      />
    </SafeAreaProvider>,
  );

  for (const trayView of view.UNSAFE_getAllByType(Tray.View)) {
    expect(StyleSheet.flatten(trayView.props.style).height).toBe(464);
  }
  expect(StyleSheet.flatten(view.UNSAFE_getByType(Tray.Content).props.style)).toMatchObject({
    marginBottom: -24,
  });
});

it("navigates into a filter facet through the Tray view stack", () => {
  Dimensions.set({ window: { ...originalWindow, height: 800, width: 400 } });
  openPullRequestFilters();
  const view = render(
    <SafeAreaProvider
      initialMetrics={{
        frame: { height: 800, width: 400, x: 0, y: 0 },
        insets: { bottom: 0, left: 0, right: 0, top: 0 },
      }}
    >
      <PullRequestFilterSheet
        accounts={[connectedAccount]}
        providers={[githubProvider]}
        repositories={[]}
      />
    </SafeAreaProvider>,
  );

  fireEvent.press(view.getByRole("button", { name: /State/u }));

  const detail = view.getByTestId("pull-request-filter-state-view");
  expect(detail).toBeOnTheScreen();
  expect(view.getByRole("button", { name: "Back" })).toBeOnTheScreen();
  fireEvent.press(within(detail).getByRole("button", { name: "Merged: off" }));
  expect(within(detail).getByTestId("pull-request-reset-filters")).toHaveTextContent("Reset");
  fireEvent.press(within(detail).getByRole("button", { name: "Apply filters" }));

  expect(pullRequestListModel.peek().query.states).toStrictEqual({
    exclude: [],
    include: ["merged"],
  });
});

it("offers only catalog accounts as filter sources", () => {
  Dimensions.set({ window: { ...originalWindow, height: 800, width: 400 } });
  const snapshot = parseForgeAccounts({
    accounts: [
      { ...connectedAccount, catalogEnabled: true },
      {
        ...connectedAccount,
        account: "github:github.com:excluded",
        catalogEnabled: false,
        login: "excluded",
      },
    ],
    flows: [],
    providers: [githubProvider],
  });
  if (snapshot === null) {
    throw new Error("The accounts fixture is invalid");
  }
  openPullRequestFilters();
  const view = render(
    <SafeAreaProvider
      initialMetrics={{
        frame: { height: 800, width: 400, x: 0, y: 0 },
        insets: { bottom: 0, left: 0, right: 0, top: 0 },
      }}
    >
      <PullRequestFilterSheet
        accounts={snapshot.accounts}
        providers={snapshot.providers}
        repositories={[]}
      />
    </SafeAreaProvider>,
  );

  fireEvent.press(view.getByRole("button", { name: /Sources/u }));

  expect(view.getByText(`${connectedAccount.login} · ${connectedAccount.host}`)).toBeOnTheScreen();
  expect(view.queryByText("excluded · github.com")).toBeNull();
});

it("keeps filter facets in the Tray view stack on fold width", () => {
  Dimensions.set({ window: { ...originalWindow, height: 800, width: 900 } });
  openPullRequestFilters();
  const view = render(
    <SafeAreaProvider
      initialMetrics={{
        frame: { height: 800, width: 900, x: 0, y: 0 },
        insets: { bottom: 0, left: 0, right: 0, top: 0 },
      }}
    >
      <PullRequestFilterSheet
        accounts={[connectedAccount]}
        providers={[githubProvider]}
        repositories={[]}
      />
    </SafeAreaProvider>,
  );

  expect(view.queryByRole("button", { name: "Back" })).toBeNull();
  fireEvent.press(view.getByRole("button", { name: /State/u }));

  expect(view.getByTestId("pull-request-filter-state-view")).toBeOnTheScreen();
  expect(view.getByRole("button", { name: "Back" })).toBeOnTheScreen();
});

it("returns from a filter facet through the Tray view stack", () => {
  Dimensions.set({ window: { ...originalWindow, height: 800, width: 400 } });
  openPullRequestFilters();
  const view = render(
    <SafeAreaProvider
      initialMetrics={{
        frame: { height: 800, width: 400, x: 0, y: 0 },
        insets: { bottom: 0, left: 0, right: 0, top: 0 },
      }}
    >
      <PullRequestFilterSheet
        accounts={[connectedAccount]}
        providers={[githubProvider]}
        repositories={[]}
      />
    </SafeAreaProvider>,
  );

  fireEvent.press(view.getByRole("button", { name: /State/u }));
  fireEvent.press(view.getByRole("button", { name: "Back" }));

  const state = pullRequestFilterSheetModel.peek();
  expect(state.status).toBe("open");
  if (state.status === "open") {
    expect(state.facet).toBeNull();
  }
});

it("reopens at the filter index after closing from a facet", () => {
  Dimensions.set({ window: { ...originalWindow, height: 800, width: 400 } });
  openPullRequestFilters();
  const view = render(
    <SafeAreaProvider
      initialMetrics={{
        frame: { height: 800, width: 400, x: 0, y: 0 },
        insets: { bottom: 0, left: 0, right: 0, top: 0 },
      }}
    >
      <PullRequestFilterSheet
        accounts={[connectedAccount]}
        providers={[githubProvider]}
        repositories={[]}
      />
    </SafeAreaProvider>,
  );

  fireEvent.press(view.getByRole("button", { name: /State/u }));
  fireEvent.press(
    within(view.getByTestId("pull-request-filter-state-view")).getByRole("button", {
      name: "Close",
    }),
  );
  act(() => {
    openPullRequestFilters();
  });

  expect(view.getByTestId("pull-request-filter-sheet")).toBeOnTheScreen();
  expect(view.queryByRole("button", { name: "Back" })).toBeNull();
  expect(view.queryByTestId("pull-request-filter-state-view")).toBeNull();
});

it("renders a stable pull-request detail skeleton from the first route frame", () => {
  const view = render(<PullRequestScreenSkeleton />);

  expect(view.getByTestId("pull-request-loading")).toBeVisible();
  expect(view.getByTestId("pull-request-loading").props.accessibilityState).toMatchObject({
    busy: true,
  });
});

it("renders stale-while-revalidate progress to the right of the catalog title", () => {
  const view = render(<PullRequestsHeader refreshing />);

  expect(view.getByTestId("pull-requests-refresh-indicator")).toBeVisible();
  expect(view.getByRole("header", { name: "Pull requests" })).toBeVisible();
  expect(view.getByTestId("pull-requests-header").props.accessibilityState).toStrictEqual({
    busy: true,
  });
});

it("keeps the published rows visible while a filter refresh is pending", () => {
  const page = parsePullRequestListPage(reviewRequestedPage);
  if (page === null) {
    throw new Error("The pull-request list fixture is invalid");
  }
  const view = render(
    <SafeAreaProvider
      initialMetrics={{
        frame: { height: 800, width: 400, x: 0, y: 0 },
        insets: { bottom: 0, left: 0, right: 0, top: 0 },
      }}
    >
      <PullRequestList
        filter={defaultPullRequestFilter()}
        iconFor={() => null}
        isThreadUnread={() => false}
        nowMs={0}
        onEndReached={() => undefined}
        onOpenFilters={() => undefined}
        onOpenSearch={() => undefined}
        onOpen={() => undefined}
        onReconnect={() => undefined}
        onRetry={() => undefined}
        onSearch={() => undefined}
        onSort={() => undefined}
        pendingFilter
        state={{ refreshing: true, status: "ready", value: page }}
      />
    </SafeAreaProvider>,
  );

  expect(view.getByText("Route forge auth errors to an auth-required state")).toBeVisible();
  expect(view.getByText("NEED ATTENTION")).toBeVisible();
  expect(view.queryByTestId("pull-request-list-notice")).toBeNull();
  expect(view.queryByTestId("pull-request-list-skeleton")).toBeNull();
  expect(view.queryByTestId("pull-request-quick-views")).toBeNull();
  expect(view.queryByTestId("pull-request-active-filters")).toBeNull();
  const list = view.UNSAFE_getByType(LegendList);
  const scrollView = list.props.renderScrollComponent?.({});
  expect(scrollView?.type).toBe(GestureDetector);
  expect(scrollView?.props.children.type).toBe(Animated.ScrollView);
  expect(scrollView?.props.gesture.gestures[0].config.testId).toBe(
    "pull-request-list-pull-to-search",
  );
  expect(view.getByTestId("pull-request-list-pull-backdrop")).toBeOnTheScreen();
});

it("sends the pull-request description through the complete bubble Markdown renderer", () => {
  const description = "| State | Result |\n| --- | --- |\n| Open | Ready |";
  const view = render(<DescriptionSection description={description} />);

  expect(view.getByTestId("rich-markdown")).toHaveTextContent(description);
});

it("renders pull-request activity comment bodies through the complete bubble Markdown renderer", () => {
  const body = "**Blocking:** use `AbortSignal` before merging.";
  const view = render(
    <ActivitySection
      anchored={new Map()}
      items={[
        {
          author: "reviewer",
          body,
          createdAt: "2026-10-24T10:00:00.000Z",
          id: "comment-1",
          kind: "comment",
          line: 12,
          path: "src/index.ts",
          reviewThreadId: null,
          verdictLabel: null,
        },
      ]}
      nowMs={Date.parse("2026-10-24T10:01:00.000Z")}
      onLoadMore={null}
      onRun={() => undefined}
      pending={{}}
    />,
  );

  expect(view.getByTestId("pull-request-activity-body-comment-1")).toBeVisible();
  expect(view.getByTestId("rich-markdown")).toHaveTextContent(body);
});
