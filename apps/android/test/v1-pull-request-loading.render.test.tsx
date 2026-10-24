import { useSelector } from "@legendapp/state/react";
import { fireEvent, render } from "@testing-library/react-native";
import { StyleSheet } from "react-native";
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
  openPullRequestFilters,
  pullRequestListModel,
  selectPullRequestCategory,
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
});

function ignore(): void {}

function QuickViewHarness(): React.JSX.Element {
  const filter = useSelector(() => pullRequestListModel.get());
  return (
    <PullRequestFilterBar
      count={0}
      filter={filter}
      onCategory={selectPullRequestCategory}
      onOpenFilters={ignore}
      onSearch={ignore}
      pending={false}
    />
  );
}

it("renders search, quick views and the filter entry point", () => {
  const view = render(
    <PullRequestFilterBar
      count={2}
      filter={defaultPullRequestFilter()}
      onCategory={() => undefined}
      onOpenFilters={() => undefined}
      onSearch={() => undefined}
      pending
    />,
  );

  expect(view.getByLabelText("Search pull requests")).toBeVisible();
  expect(view.getByRole("button", { name: "Filters" })).toBeVisible();
  expect(
    view.getByRole("tab", { name: /Needs your review/u }).props.accessibilityState,
  ).toMatchObject({ busy: true, selected: true });
  expect(view.getByRole("tab", { name: "All" })).toBeVisible();
});

it("switches quick views forward and back", () => {
  pullRequestListModel.set(defaultPullRequestFilter());
  const view = render(<QuickViewHarness />);

  fireEvent.press(view.getByRole("tab", { name: "Mine" }));
  expect(view.getByRole("tab", { name: /Mine/u }).props.accessibilityState).toMatchObject({
    selected: true,
  });

  fireEvent.press(view.getByRole("tab", { name: "Needs your review" }));
  expect(
    view.getByRole("tab", { name: /Needs your review/u }).props.accessibilityState,
  ).toMatchObject({ selected: true });
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
  expect(
    StyleSheet.flatten(view.getByRole("button", { name: "Apply filters" }).props.style),
  ).toMatchObject({
    alignItems: "center",
    width: "100%",
  });
});

it("renders a stable pull-request detail skeleton from the first route frame", () => {
  const view = render(<PullRequestScreenSkeleton />);

  expect(view.getByTestId("pull-request-loading")).toBeVisible();
  expect(view.getByTestId("pull-request-loading").props.accessibilityState).toMatchObject({
    busy: true,
  });
});

it("keeps the published rows visible while a category transition is pending", () => {
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
        filter={{
          ...defaultPullRequestFilter(),
          query: { ...defaultPullRequestFilter().query, category: "authored" },
        }}
        iconFor={() => null}
        nowMs={0}
        onCategory={() => undefined}
        onEndReached={() => undefined}
        onOpenFilters={() => undefined}
        onOpen={() => undefined}
        onReconnect={() => undefined}
        onRetry={() => undefined}
        onSearch={() => undefined}
        pendingFilter
        providers={[githubProvider]}
        state={{ refreshing: true, status: "ready", value: page }}
      />
    </SafeAreaProvider>,
  );

  expect(view.getByText("Route forge auth errors to an auth-required state")).toBeVisible();
  expect(view.getByText("NEED ATTENTION")).toBeVisible();
  expect(view.queryByTestId("pull-request-list-skeleton")).toBeNull();
  expect(view.getByRole("tab", { name: /Mine/u }).props.accessibilityState).toMatchObject({
    busy: true,
    selected: true,
  });
});

it("sends the pull-request description through the shared rich Markdown renderer", () => {
  const description = "```mermaid\ngraph TD\nA-->B\n```";
  const view = render(<DescriptionSection description={description} />);

  expect(view.getByTestId("rich-markdown")).toHaveTextContent(description);
});
