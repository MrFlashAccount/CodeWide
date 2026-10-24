import { LegendList } from "@legendapp/list/react-native";
import { fireEvent, render } from "@testing-library/react-native";
import { Animated, StyleSheet } from "react-native";
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
  pullRequestListModel,
  selectPullRequestFilterFacet,
} from "../src/features/pullRequests/pullRequestListModel";
import {
  connectedAccount,
  githubProvider,
  reviewRequestedPage,
} from "./fixtures/forgeWireFixtures";

jest.mock("../src/rendering/RichMarkdown", () => {
  const { Text } = jest.requireActual("react-native");
  return {
    RichMarkdown: ({ source }: { readonly source: string }) => (
      <Text testID="rich-markdown">{source}</Text>
    ),
  };
});

afterEach(() => {
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
  expect(view.getByTestId("pull-request-reset-filters")).toHaveTextContent("Reset");
  expect(view.getByTestId("pull-request-reset-filters").props.accessibilityState).toMatchObject({
    disabled: true,
  });
  expect(
    StyleSheet.flatten(view.getByRole("button", { name: "Apply filters" }).props.style),
  ).toMatchObject({
    alignItems: "center",
    width: "100%",
  });
});

it("replaces the implicit Open state when a different state is selected", () => {
  openPullRequestFilters();
  selectPullRequestFilterFacet("state");
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

  fireEvent.press(view.getByRole("button", { name: "Merged: off" }));
  fireEvent.press(view.getByRole("button", { name: "Apply filters" }));

  expect(pullRequestListModel.peek().query.states).toStrictEqual({
    exclude: [],
    include: ["merged"],
  });
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
