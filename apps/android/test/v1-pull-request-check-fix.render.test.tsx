import { fireEvent, render, screen, within } from "@testing-library/react-native";
import type { ReactNode } from "react";

import { parseActionCatalog, type ActionDescriptor } from "../src/data/forgeActionCatalog";
import { headRevision } from "../src/data/forgeContract";
import type { CheckItem } from "../src/data/forgePullRequestContract";
import { threadId } from "../src/data/reviewContract";
import { slotActions } from "../src/features/pullRequestDetail/actions/actionSlotting";
import type { ScenarioViews } from "../src/features/pullRequestDetail/actions/scenarioRuns";
import { ScenarioViewsContext } from "../src/features/pullRequestDetail/actions/ScenarioViewsContext";
import { ChecksSheet } from "../src/features/pullRequestDetail/overview/ChecksSheet";

// WHY: the native sheet window cannot mount in the Node renderer; the sheet's rows are the contract here.
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

const HEAD = headRevision("head-1", "headRevision");

function check(checkId: string, state: CheckItem["state"]): CheckItem {
  return { checkId, detailsUrl: null, durationSeconds: 60, name: checkId, state };
}

const CHECKS: readonly CheckItem[] = [
  check("macos", "failed"),
  check("linux", "failed"),
  check("plan", "passed"),
];

/** The Companion's catalog: one fix per failed check, each with its own action id. */
function catalog(): readonly ActionDescriptor[] {
  const fix = (checkId: string) => ({
    actionId: `codewide.scenario.fixCi.${checkId}`,
    anchor: { checkId, kind: "checks" },
    availability: { state: "enabled" },
    confirm: "none",
    group: "agent",
    input: null,
    isDefault: false,
    kind: "fixCi",
    label: "Fix in agent",
    order: 100,
    placement: "secondary",
    toggle: null,
  });
  const parsed = parseActionCatalog(
    { actions: [fix("macos"), fix("linux")], headRevision: HEAD },
    () => undefined,
  );
  if (parsed === null) {
    throw new Error("the fix catalog fixture must parse");
  }
  return parsed.actions;
}

function renderSheet(
  actions: readonly ActionDescriptor[],
  views: ScenarioViews,
  onRun: (action: ActionDescriptor) => void,
) {
  const slots = slotActions(
    actions,
    {
      checkIds: new Set(CHECKS.map((item) => item.checkId)),
      conflict: false,
      reviewThreadIds: new Set(),
    },
    { availableWidth: 400, gap: 8, measure: () => 100, tablet: false },
  );
  return render(
    <ScenarioViewsContext.Provider value={views}>
      <ChecksSheet
        actionsFor={(checkId) => slots.anchored.checks.get(checkId) ?? []}
        checks={CHECKS}
        host="github.com"
        onDismiss={() => undefined}
        onRun={onRun}
        pending={{}}
        summary="2 failing, 1 successful"
      />
    </ScenarioViewsContext.Provider>,
  );
}

it("puts an agent fix on every failed check and none on a passing one", () => {
  const onRun = jest.fn<undefined, [ActionDescriptor]>();
  renderSheet(catalog(), new Map(), onRun);

  const macos = screen.getByLabelText("Fix macos in agent");
  const linux = screen.getByLabelText("Fix linux in agent");
  expect(screen.queryByLabelText("Fix plan in agent")).toBeNull();
  // Idle, the icon alone carries the action.
  expect(within(macos).queryByText("Fix in agent")).toBeNull();

  fireEvent.press(linux);
  fireEvent.press(macos);
  expect(
    onRun.mock.calls.map(([action]) =>
      action.anchor?.kind === "checks" ? action.anchor.checkId : null,
    ),
  ).toEqual(["linux", "macos"]);
});

it("shows and shimmers the live label beside the icon while that check's fix runs", () => {
  const running = catalog().map((action) =>
    action.anchor?.kind === "checks" && action.anchor.checkId === "linux"
      ? { ...action, label: "Fixing CI…" }
      : action,
  );
  const views: ScenarioViews = new Map([
    [
      "codewide.scenario.fixCi.linux",
      { kind: "active", startedAt: null, threadId: threadId("thread-1", "threadId") },
    ],
  ]);
  renderSheet(running, views, () => undefined);
  const linux = screen.getByLabelText("Fix linux in agent");
  expect(linux).toHaveProp("accessibilityState", { busy: true, disabled: false });
  expect(within(linux).getByText("Fixing CI…")).toBeOnTheScreen();
  const macos = screen.getByLabelText("Fix macos in agent");
  expect(macos).toHaveProp("accessibilityState", { busy: false, disabled: false });
  expect(within(macos).queryByText(/Fix/u)).toBeNull();
});
