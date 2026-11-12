import { act, fireEvent, within } from "@testing-library/react-native";
import type { ReactNode } from "react";

import { ActionMenu } from "../src/ui/ActionMenu";
import { action, overview91 } from "./fixtures/forgeWireFixtures";
import {
  renderScreen,
  unmountScreens,
  type Capabilities,
  type WireOverview,
} from "./fixtures/pullRequestDetailsHarness";
import { resetAppDialog } from "./mocks/AppDialog";

// Details places the plugin's actions where they act: Checks section actions (Start CI) in the
// Status section's Checks row, the verdict group as a split button that only opens Submit review,
// and the page's links and overflowed actions in the app bar ⋮ menu.

// WHY: Expo's filesystem bridge cannot initialize in Node; the editor's suggestion popup imports it.
jest.mock("expo-file-system/legacy", () => ({ cacheDirectory: null }));

// WHY: the native sheet window cannot mount in the Node renderer; the sheet's content is the contract here.
jest.mock("../src/ui/AppSheet", () => {
  const { View: MockView } = jest.requireActual<typeof import("react-native")>("react-native");
  return {
    AppSheet: ({ children }: { readonly children: ReactNode }) => <MockView>{children}</MockView>,
    AppSheetScrollView: ({
      children,
      testID,
    }: {
      readonly children: ReactNode;
      readonly testID?: string;
    }) => <MockView testID={testID}>{children}</MockView>,
  };
});

beforeEach(() => {
  resetAppDialog();
});

afterEach(async () => {
  await unmountScreens();
});

const START_CI = action("startCi", {
  anchor: { kind: "checksSection" },
  group: "ci",
  isDefault: true,
  label: "Start CI",
  order: 11,
  placement: "primary",
});

function withActions(
  base: WireOverview,
  actions: readonly Record<string, unknown>[],
  overrides: Readonly<Record<string, unknown>> = {},
): WireOverview {
  return {
    ...base,
    catalog: { actions, headRevision: overview91.catalog.headRevision },
    ...overrides,
  };
}

const NO_CHECKS = {
  checkItems: [],
  checks: { failing: 0, passed: 0, pending: 0, state: "none" },
};

/**
 * Details once its reads settled: the conversation loads only after the accounts snapshot named
 * the plugin, so the forge name and every avatar are in place before the test acts.
 */
async function renderDetails(
  options: Parameters<typeof renderScreen>[0],
): Promise<ReturnType<typeof renderScreen>["view"]> {
  const { view } = renderScreen(options);
  await view.findByTestId("pull-request-discussion-heading-count");
  return view;
}

/** Never settles, so the run stays pending for the assertion. */
function pendingRun(): Capabilities["runAction"] {
  return jest.fn<ReturnType<Capabilities["runAction"]>, Parameters<Capabilities["runAction"]>>(
    async () =>
      new Promise(() => {
        // Left pending on purpose.
      }),
  );
}

describe("Checks section actions", () => {
  it("puts Start CI in the Checks row, never in the header row, and runs it from there", async () => {
    const runAction = pendingRun();
    const view = await renderDetails({
      capabilityOverrides: { runAction },
      overview: withActions(overview91, [...overview91.catalog.actions, START_CI]),
    });
    const checks = await view.findByTestId("pull-request-status-checks");

    // Visible while the row is collapsed, next to the real summary.
    expect(within(checks).getByTestId("pull-request-status-checks-detail")).toHaveTextContent(
      "1 failing, 6 successful",
    );
    const start = within(checks).getByTestId("catalog-action-startCi");
    expect(
      within(view.getByTestId("pull-request-action-row")).queryByTestId("catalog-action-startCi"),
    ).toBeNull();

    fireEvent.press(start);
    expect(runAction.mock.calls.map(([, request]) => request.actionId)).toEqual(["startCi"]);
    // The pending run keeps its label in place and refuses a second tap.
    expect(within(view.getByTestId("pull-request-status-checks")).getByTestId(
      "catalog-action-startCi",
    )).toHaveProp("accessibilityState", { busy: true, disabled: true });
  });

  it("keeps a Checks row for Start CI when the forge reports no checks", async () => {
    const view = await renderDetails({
      overview: withActions(overview91, [START_CI], NO_CHECKS),
    });
    const checks = await view.findByTestId("pull-request-status-checks");

    expect(within(checks).getByTestId("pull-request-status-checks-detail")).toHaveTextContent(
      "No checks reported",
    );
    expect(within(checks).getByTestId("catalog-action-startCi")).toHaveTextContent("Start CI");
  });

  it("shows no Checks row without checks or a Checks section action", async () => {
    const view = await renderDetails({ overview: withActions(overview91, [], NO_CHECKS) });
    await view.findByTestId("pull-request-merge-box-state");

    expect(view.queryByTestId("pull-request-status-checks")).toBeNull();
  });

  it("moves Start CI to the menu on a merged pull request, which has no Checks row", async () => {
    const view = await renderDetails({
      overview: withActions(overview91, [START_CI], { ...NO_CHECKS, state: "merged" }),
    });
    fireEvent.press(await view.findByLabelText("Pull request menu"));

    expect(view.queryByTestId("pull-request-status-checks")).toBeNull();
    expect(view.getByLabelText("Pull request menu: Start CI")).toBeOnTheScreen();
  });
});

describe("app bar menu", () => {
  it("leads with Copy link, Share and Open in the forge, then the overflowed actions with Close destructive", async () => {
    const view = await renderDetails({});
    fireEvent.press(await view.findByLabelText("Pull request menu"));

    const labels = view
      .getAllByLabelText(/^Pull request menu: /u)
      .map((item) => String(item.props.accessibilityLabel).replace("Pull request menu: ", ""));
    expect(labels.slice(0, 3)).toEqual(["Copy link", "Share", "Open in GitHub"]);
    expect(labels).toContain("Close pull request");
    const menu = view
      .UNSAFE_getAllByType(ActionMenu)
      .find((candidate) => candidate.props.accessibilityLabel === "Pull request menu");
    expect(
      menu?.props.actions.find(
        (item: { readonly label: string }) => item.label === "Close pull request",
      ),
    ).toMatchObject({ destructive: true });
  });
});

const VERDICTS = [
  action("ship", { group: "verdict", isDefault: true, kind: "verdict", label: "Ship", order: 7 }),
  action("block", {
    confirm: "destructive",
    group: "verdict",
    kind: "verdict",
    label: "Block",
    order: 8,
  }),
  action("comment", { group: "verdict", kind: "verdict", label: "Comment", order: 9 }),
];

function submitted(): Capabilities["submitReview"] {
  return jest.fn<
    ReturnType<Capabilities["submitReview"]>,
    Parameters<Capabilities["submitReview"]>
  >(async () => Promise.resolve({ drafts: [], reviewUrl: null }));
}

describe("verdict split button", () => {
  it("leads with the default verdict and opens Submit review preselected with the chosen one", async () => {
    const submitReview = submitted();
    const view = await renderDetails({
      capabilityOverrides: { submitReview },
      overview: withActions(overview91, VERDICTS),
    });
    expect(await view.findByTestId("pull-request-verdict-main")).toHaveTextContent("Ship");
    // Choosing a verdict publishes nothing by itself.
    expect(view.queryByTestId("submit-review-sheet")).toBeNull();

    fireEvent.press(view.getByTestId("pull-request-verdict-menu"));
    const menu = view
      .UNSAFE_getAllByType(ActionMenu)
      .find((candidate) => candidate.props.accessibilityLabel === "Verdict");
    expect(
      menu?.props.actions.find((item: { readonly label: string }) => item.label === "Block"),
    ).toMatchObject({ destructive: true });
    fireEvent.press(view.getByLabelText("Verdict: Comment"));

    const sheet = within(view.getByTestId("submit-review-sheet"));
    expect(sheet.getByTestId("submit-review-confirm")).toHaveTextContent("Submit review · Comment");
    expect(submitReview).not.toHaveBeenCalled();

    await act(async () => {
      fireEvent.press(sheet.getByTestId("submit-review-confirm"));
      await Promise.resolve();
    });
    expect(submitReview.mock.calls.map(([, request]) => request.verdictActionId)).toEqual([
      "comment",
    ]);
    expect(view.queryByTestId("submit-review-sheet")).toBeNull();
    expect(view.getByTestId("review-dock-outcome")).toBeOnTheScreen();
  });

  it("opens Submit review with the lead verdict from the main segment", async () => {
    const view = await renderDetails({ overview: withActions(overview91, VERDICTS) });
    fireEvent.press(await view.findByTestId("pull-request-verdict-main"));

    expect(
      within(view.getByTestId("submit-review-sheet")).getByTestId("submit-review-confirm"),
    ).toHaveTextContent("Submit review · Ship");
  });

  it("shows nothing prominent when only one verdict is enabled and keeps Submit review in the menu", async () => {
    const own = VERDICTS.map((verdict) =>
      verdict.actionId === "comment"
        ? { ...verdict, isDefault: true }
        : {
            ...verdict,
            availability: { reason: "You cannot review your own pull request", state: "disabled" },
            isDefault: false,
          },
    );
    const view = await renderDetails({ overview: withActions(overview91, own) });
    fireEvent.press(await view.findByLabelText("Pull request menu"));

    expect(view.queryByTestId("pull-request-verdict")).toBeNull();
    fireEvent.press(view.getByLabelText("Pull request menu: Submit review"));
    expect(
      within(view.getByTestId("submit-review-sheet")).getByTestId("submit-review-confirm"),
    ).toHaveTextContent("Submit review · Comment");
  });
});
