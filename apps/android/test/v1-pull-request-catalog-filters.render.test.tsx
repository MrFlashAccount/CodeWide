import { act, fireEvent, render, within } from "@testing-library/react-native";
import { Dimensions } from "react-native";
import { SafeAreaProvider } from "react-native-safe-area-context";

import { parseForgeAccounts } from "../src/data/forgeContract";
import { parsePullRequestListPage } from "../src/data/forgePullRequestContract";
import { createForgeResources } from "../src/data/forgeResources";
import { PullRequestFilterSheet } from "../src/features/pullRequests/list/PullRequestFilterSheet";
import { PullRequestsCatalog } from "../src/features/pullRequests/PullRequestsFeature";
import { PullRequestsHeader } from "../src/features/pullRequests/PullRequestsHeader";
import {
  closePullRequestSearch,
  defaultPullRequestFilter,
  dismissPullRequestFilters,
  openPullRequestFilters,
  pullRequestListModel,
} from "../src/features/pullRequests/pullRequestListModel";
import type { PullRequestsWorkspaceCapabilities } from "../src/features/pullRequests/workspaceCapabilities";
import { connectedAccount, githubProvider, involvedPage } from "./fixtures/forgeWireFixtures";
import { createMemoryQueryPersister } from "./fixtures/queryPersister";

const METRICS = {
  frame: { height: 800, width: 400, x: 0, y: 0 },
  insets: { bottom: 0, left: 0, right: 0, top: 0 },
};
const SEARCH = "companion/pullRequests/search";
const originalWindow = Dimensions.get("window");

afterEach(() => {
  Dimensions.set({ window: originalWindow });
  pullRequestListModel.set(defaultPullRequestFilter());
  dismissPullRequestFilters();
  closePullRequestSearch();
});

const capabilities: PullRequestsWorkspaceCapabilities = {
  cancelAuth: () => Promise.resolve(),
  checkAgain: () => Promise.resolve(),
  disconnect: () => Promise.resolve(),
  setAccountEnabled: () => Promise.reject(new Error("Not used by this render test")),
  startAuth: () => Promise.reject(new Error("Not used by this render test")),
  submitToken: () => Promise.reject(new Error("Not used by this render test")),
};

function renderCatalog() {
  const searches: unknown[] = [];
  let announceSearch = (): void => undefined;
  const searched = new Promise<void>((resolve) => {
    announceSearch = resolve;
  });
  const rpcAfterAttach = async <Result,>(
    _session: unknown,
    method: string,
    params: unknown,
  ): Promise<Result> => {
    if (method !== SEARCH) {
      throw new Error(`Unexpected ${method}`);
    }
    searches.push(params);
    announceSearch();
    // WHY: the fake transport returns a wire fixture; the app's own parser validates it.
    // oxlint-disable-next-line typescript/no-unsafe-type-assertion
    return involvedPage as Result;
  };
  // WHY: the fake session is only a handle passed back to rpcAfterAttach.
  // oxlint-disable-next-line typescript/no-unsafe-type-assertion
  const session = {} as never;
  const forge = createForgeResources({
    getSession: () => session,
    persister: createMemoryQueryPersister().persister,
    reportDroppedAction: () => undefined,
    rpcAfterAttach,
  });
  const page = parsePullRequestListPage(involvedPage);
  const accounts = parseForgeAccounts({
    accounts: [connectedAccount],
    flows: [],
    providers: [githubProvider],
  });
  if (page === null || accounts === null) {
    throw new Error("The pull-request fixture is invalid");
  }
  const filter = defaultPullRequestFilter();
  pullRequestListModel.set(filter);
  forge.accounts.publish({ connectionId: "server" }, accounts);
  forge.lists.publish({ connectionId: "server", filter }, page);
  const view = render(
    <SafeAreaProvider initialMetrics={METRICS}>
      <PullRequestsCatalog
        capabilities={capabilities}
        connectionId="server"
        forge={forge}
        onOpenPullRequest={() => undefined}
      />
    </SafeAreaProvider>,
  );
  return { forge, searched, searches, view };
}

async function nextTimerTurn(): Promise<void> {
  await new Promise<void>((resolve) => {
    setTimeout(resolve, 0);
  });
}

function renderFilterSheet() {
  Dimensions.set({ window: { ...originalWindow, height: 800, width: 400 } });
  openPullRequestFilters();
  return render(
    <SafeAreaProvider initialMetrics={METRICS}>
      <PullRequestFilterSheet
        accounts={[connectedAccount]}
        providers={[githubProvider]}
        repositories={[]}
      />
    </SafeAreaProvider>,
  );
}

it("selects a category with one tap and searches with it", async () => {
  const { forge, searched, searches, view } = renderCatalog();
  const chips = within(view.getByTestId("pull-request-category-chips"));

  expect(chips.getByRole("button", { name: "Involved" })).toBeSelected();
  // Only categories a catalog account declares are offered.
  expect(chips.queryByRole("button", { name: "All" })).toBeNull();

  fireEvent.press(chips.getByRole("button", { name: "Mine" }));

  // The published rows stay in place while the new category loads.
  expect(view.getByText("Route forge auth errors to an auth-required state")).toBeOnTheScreen();

  await act(async () => {
    await searched;
    // TanStack Query notifies observers on a zero-delay timer; let the answered page publish.
    while (forge.lists.client.isFetching() > 0) {
      await nextTimerTurn();
    }
    await nextTimerTurn();
  });

  expect(searches).toStrictEqual([
    expect.objectContaining({ query: expect.objectContaining({ category: "authored" }) }),
  ]);
  expect(pullRequestListModel.peek().query.category).toBe("authored");
  expect(
    within(view.getByTestId("pull-request-category-chips")).getByRole("button", {
      name: "Mine",
    }),
  ).toBeSelected();
  expect(view.queryByTestId("pull-requests-refresh-indicator")).toBeNull();
});

it("adds a person token on comma without waiting for the field to blur", () => {
  const view = renderFilterSheet();
  fireEvent.press(view.getByRole("button", { name: /People/u }));
  const authors = within(view.getByTestId("pull-request-term-authors"));

  fireEvent.changeText(authors.getByLabelText("Author"), "alice,");

  expect(authors.getByRole("button", { name: "Remove Author alice" })).toBeOnTheScreen();
  expect(authors.getByLabelText("Author").props.value).toBe("");

  fireEvent.changeText(authors.getByLabelText("Author"), "bob");
  fireEvent(authors.getByLabelText("Author"), "submitEditing");

  expect(authors.getByRole("button", { name: "Remove Author bob" })).toBeOnTheScreen();
  fireEvent.press(authors.getByRole("button", { name: "Remove Author alice" }));
  expect(authors.queryByRole("button", { name: "Remove Author alice" })).toBeNull();
});

it("commits typed but unentered values when Apply is tapped", () => {
  const view = renderFilterSheet();
  fireEvent.press(view.getByRole("button", { name: /Metadata/u }));
  const labels = within(view.getByTestId("pull-request-term-labels"));

  fireEvent.changeText(labels.getByLabelText("Labels"), "release");
  fireEvent.press(
    within(view.getByTestId("pull-request-filter-metadata-view")).getByRole("button", {
      name: "Apply filters",
    }),
  );

  expect(pullRequestListModel.peek().query.labels).toStrictEqual({
    exclude: [],
    include: ["release"],
  });
});

it("offers the linked account's login as a one-tap person", () => {
  const view = renderFilterSheet();
  fireEvent.press(view.getByRole("button", { name: /People/u }));
  const reviewers = within(view.getByTestId("pull-request-term-reviewers"));

  fireEvent.press(
    reviewers.getByRole("button", {
      name: `Add Reviewed by ${connectedAccount.login} (you)`,
    }),
  );
  fireEvent.press(
    within(view.getByTestId("pull-request-filter-people-view")).getByRole("button", {
      name: "Apply filters",
    }),
  );

  expect(pullRequestListModel.peek().query.reviewers.include).toStrictEqual([
    connectedAccount.login,
  ]);
});

it("opens accounts from a header action that names them", () => {
  const onManageProviders = jest.fn();
  const view = render(<PullRequestsHeader onManageProviders={onManageProviders} />);

  fireEvent.press(view.getByRole("button", { name: "Accounts" }));

  expect(onManageProviders).toHaveBeenCalledTimes(1);
});
