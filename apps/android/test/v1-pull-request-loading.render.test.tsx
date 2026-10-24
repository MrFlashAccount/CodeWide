import { LegendList } from "@legendapp/list/react-native";
import { act, fireEvent, render, within } from "@testing-library/react-native";
import { Animated, Dimensions, StyleSheet } from "react-native";
import { GestureDetector } from "react-native-gesture-handler";
import { SafeAreaProvider } from "react-native-safe-area-context";

import { parsePullRequestListPage } from "../src/data/forgePullRequestContract";
import { PullRequestScreenSkeleton } from "../src/features/pullRequestDetail/PullRequestScreenSkeleton";
import { DescriptionSection } from "../src/features/pullRequestDetail/overview/DescriptionSection";
import { PullRequestFilterBar } from "../src/features/pullRequests/list/PullRequestFilterBar";
import { PullRequestFilterSheet } from "../src/features/pullRequests/list/PullRequestFilterSheet";
import { PullRequestList } from "../src/features/pullRequests/list/PullRequestList";
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
      onSearch={() => undefined}
      onSort={() => undefined}
    />,
  );

  expect(view.getByLabelText("Search pull requests")).toBeVisible();
  expect(view.getByRole("button", { name: "Filters" })).toBeVisible();
  expect(view.queryByTestId("pull-request-quick-views")).toBeNull();
  expect(view.queryByTestId("pull-request-active-filters")).toBeNull();
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
        accounts={[connectedAccount]}
        filter={defaultPullRequestFilter()}
        iconFor={() => null}
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
        providers={[githubProvider]}
        state={{ refreshing: true, status: "ready", value: page }}
      />
    </SafeAreaProvider>,
  );

  expect(view.getByText("Route forge auth errors to an auth-required state")).toBeVisible();
  expect(view.getByText("NEED ATTENTION")).toBeVisible();
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

it("sends the pull-request description through the shared rich Markdown renderer", () => {
  const description = "```mermaid\ngraph TD\nA-->B\n```";
  const view = render(<DescriptionSection description={description} />);

  expect(view.getByTestId("rich-markdown")).toHaveTextContent(description);
});
