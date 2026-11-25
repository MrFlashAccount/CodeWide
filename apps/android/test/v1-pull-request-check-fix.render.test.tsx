import { fireEvent, render, screen } from "@testing-library/react-native";
import type { ComponentProps, ReactNode } from "react";
import { Linking } from "react-native";

import type { ActionDescriptor } from "../src/data/forgeActionCatalog";
import type { CheckItem } from "../src/data/forgePullRequestContract";
import { ChecksSheet } from "../src/features/pullRequestDetail/overview/ChecksSheet";

// The platform sheet window cannot mount in Node. LegendList's native viewport double keeps the real lifecycle hooks.
jest.mock("../src/ui/AppSheet", () => {
  const { View, ScrollView } = jest.requireActual<typeof import("react-native")>("react-native");
  return {
    AppSheet: ({ children }: { readonly children: ReactNode }) => <View>{children}</View>,
    AppSheetScrollView: ScrollView,
  };
});

function job(
  checkId: string,
  state: CheckItem["state"],
  required: boolean | null,
  extra: Partial<CheckItem> = {},
): CheckItem {
  return {
    activity: null,
    checkId,
    detailsUrl: null,
    durationSeconds: null,
    name: checkId,
    onDemand: null,
    required,
    state,
    viewerUrl: null,
    ...extra,
  };
}
const checks = [
  job("pack", "passed", true, { viewerUrl: "https://ci.example/run/42" }),
  job("lint", "failed", true),
  job("build", "pending", true, { activity: "running" }),
  job("samples", "passed", false),
  job("legacy", "pending", null, { detailsUrl: "https://off-site.example/run" }),
];
function action(
  kind: ActionDescriptor["kind"],
  label: string,
  checkId: string | null,
): ActionDescriptor {
  return {
    actionId: `${kind}-${checkId ?? "all"}`,
    anchor: checkId === null ? { kind: "checksSection" } : { kind: "checks", checkId },
    availability: { state: "enabled" },
    confirm: "none",
    group: "checks",
    input: null,
    isDefault: false,
    kind,
    label,
    order: 1,
    placement: "secondary",
    quickSubmit: false,
    toggle: null,
  };
}
const address = action("fixCi", "Address all checks", null);
const restart = action("restartCheck", "Restart job", "lint");
const remove: ActionDescriptor = {
  ...action("setCheckRequired", "Remove merge requirement", "lint"),
  input: { type: "text", label: "Reason", placeholder: null },
  toggle: { on: true },
};
const forbidden: ActionDescriptor = {
  ...action("setCheckRequired", "Remove merge requirement", "pack"),
  availability: { state: "disabled", reason: "Project policy" },
  toggle: { on: true },
};
const disabledRestart: ActionDescriptor = {
  ...action("restartCheck", "Restart job", "build"),
  availability: { state: "disabled", reason: "Already running" },
};
const actions = [
  restart,
  remove,
  forbidden,
  disabledRestart,
  action("fixCi", "Fix in agent", "lint"),
];
function props(
  overrides: Partial<ComponentProps<typeof ChecksSheet>> = {},
): ComponentProps<typeof ChecksSheet> {
  return {
    actionsFor: (checkId) =>
      actions.filter((item) => item.anchor?.kind === "checks" && item.anchor.checkId === checkId),
    addressAction: address,
    checks,
    host: "forge.example",
    onDismiss: jest.fn(),
    onRun: jest.fn(),
    pending: {},
    pendingToggles: {},
    ...overrides,
  };
}

it("keeps required jobs ordered and immediately visible, and can search the collapsed jobs without changing the saved disclosure", () => {
  render(<ChecksSheet {...props()} />);
  const rows = () =>
    screen.getAllByTestId(/^pull-request-checks-job-/u).map((row) => row.props.testID);
  expect(rows()).toEqual(
    ["build", "lint", "pack", "legacy"].map((id) => `pull-request-checks-job-${id}`),
  );
  expect(screen.queryByTestId("pull-request-checks-required-legacy")).toBeNull();
  const search = screen.getByLabelText("Search checks");
  fireEvent.changeText(search, "sAmPlE");
  expect(rows()).toEqual(["pull-request-checks-job-samples"]);
  fireEvent.changeText(search, "");
  expect(screen.queryByTestId("pull-request-checks-job-samples")).toBeNull();
  fireEvent.press(screen.getByTestId("pull-request-checks-other"));
  expect(screen.getByTestId("pull-request-checks-job-samples")).toBeOnTheScreen();
});

it("opens the admitted viewer from the row, and only offers available restarts in its separate native menu", () => {
  const open = jest.spyOn(Linking, "openURL").mockResolvedValue(undefined);
  const state = props();
  try {
    render(<ChecksSheet {...state} />);
    fireEvent.press(screen.getByTestId("pull-request-checks-job-pack"));
    expect(open).toHaveBeenCalledWith("https://ci.example/run/42");
    expect(screen.getAllByRole("link")).toHaveLength(1);
    expect(screen.queryByTestId("pull-request-checks-menu-build")).toBeNull();
    fireEvent.press(screen.getByTestId("pull-request-checks-menu-lint"));
    fireEvent.press(screen.getByText("Restart job"));
    expect(state.onRun).toHaveBeenCalledWith(restart);
    expect(screen.queryByText("Fix in agent")).toBeNull();
  } finally {
    open.mockRestore();
  }
});

it("uses the permission, reason input and refreshed state from the catalog; an acknowledged waiver moves to Other checks", () => {
  const state = props();
  const view = render(<ChecksSheet {...state} />);
  const denied = screen.getByTestId("pull-request-checks-required-pack");
  expect(denied).toBeDisabled();
  expect(denied).toHaveProp("accessibilityHint", "Project policy");
  fireEvent.press(denied);
  expect(state.onRun).not.toHaveBeenCalled();
  fireEvent.press(screen.getByTestId("pull-request-checks-required-lint"));
  expect(state.onRun).toHaveBeenCalledWith(remove);
  expect(screen.getByTestId("pull-request-checks-job-lint")).toBeOnTheScreen();
  view.rerender(
    <ChecksSheet
      {...state}
      checks={checks.map((item) => (item.checkId === "lint" ? { ...item, required: false } : item))}
      actionsFor={() => []}
    />,
  );
  expect(screen.queryByTestId("pull-request-checks-job-lint")).toBeNull();
  fireEvent.press(screen.getByTestId("pull-request-checks-other"));
  expect(screen.getByLabelText("lint, required for merge")).not.toBeChecked();
});

it("addresses the entire PR even with passing checks and an empty search result", () => {
  const state = props({ checks: [job("pass", "passed", null)] });
  render(<ChecksSheet {...state} />);
  expect(screen.getByTestId("pull-request-checks-job-pass")).toBeOnTheScreen();
  expect(screen.queryByTestId("pull-request-checks-other")).toBeNull();
  fireEvent.changeText(screen.getByLabelText("Search checks"), "not in this PR");
  expect(screen.getByText("No matching checks")).toBeOnTheScreen();
  fireEvent.press(screen.getByRole("button", { name: "Address all checks" }));
  expect(state.onDismiss).toHaveBeenCalledTimes(1);
  expect(state.onRun).toHaveBeenCalledWith(address);
});
