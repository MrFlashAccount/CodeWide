import { render, within } from "@testing-library/react-native";
import { ScrollView } from "react-native";

import { parsePullRequestListPage } from "../src/data/forgePullRequestContract";
import { PullRequestScreenSkeleton } from "../src/features/pullRequestDetail/PullRequestScreenSkeleton";
import { DescriptionSection } from "../src/features/pullRequestDetail/overview/DescriptionSection";
import { CategoryChips } from "../src/features/pullRequests/list/CategoryChips";
import { PullRequestList } from "../src/features/pullRequests/list/PullRequestList";
import { reviewRequestedPage } from "./fixtures/forgeWireFixtures";

jest.mock("../src/rendering/RichMarkdown", () => {
  const { Text } = jest.requireActual("react-native");
  return {
    RichMarkdown: ({ source }: { readonly source: string }) => (
      <Text testID="rich-markdown">{source}</Text>
    ),
  };
});

it("keeps the repository control outside the independently scrolling category tabs", () => {
  const view = render(
    <CategoryChips
      category="reviewRequested"
      counts={{}}
      onOpenRepositories={() => undefined}
      onSelect={() => undefined}
      pending={{ category: true, repository: true }}
      repository={null}
      supported={new Set(["reviewRequested", "authored"])}
    />,
  );

  const repository = view.getByTestId("pull-request-repository-filter");
  const categories = view.UNSAFE_getByType(ScrollView);
  expect(within(categories).queryByTestId("pull-request-repository-filter")).toBeNull();
  expect(repository.props.accessibilityState).toMatchObject({ busy: true });
  expect(view.getByRole("tab", { name: "Review requested" }).props.accessibilityState).toMatchObject(
    { busy: true, selected: true },
  );
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
    <PullRequestList
      filter={{ category: "authored", repository: null }}
      iconFor={() => null}
      nowMs={0}
      onCategory={() => undefined}
      onEndReached={() => undefined}
      onOpen={() => undefined}
      onReconnect={() => undefined}
      onRepository={() => undefined}
      onRetry={() => undefined}
      pendingFilter={{ category: true, repository: false }}
      state={{ refreshing: true, status: "ready", value: page }}
    />,
  );

  expect(view.getByText("Route forge auth errors to an auth-required state")).toBeVisible();
  expect(view.queryByTestId("pull-request-list-skeleton")).toBeNull();
  expect(view.getByRole("tab", { name: "Mine" }).props.accessibilityState).toMatchObject({
    busy: true,
    selected: true,
  });
});

it("sends the pull-request description through the shared rich Markdown renderer", () => {
  const description = "```mermaid\ngraph TD\nA-->B\n```";
  const view = render(<DescriptionSection description={description} />);

  expect(view.getByTestId("rich-markdown")).toHaveTextContent(description);
});
