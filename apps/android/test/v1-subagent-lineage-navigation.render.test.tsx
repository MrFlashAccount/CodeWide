import { act, fireEvent, render, waitFor } from "@testing-library/react-native";
import { AccessibilityInfo } from "react-native";

import { createThreadDetailDatabase } from "../src/data/thread-detail-database.native";
import type { StoredThreadSummary } from "../src/data/thread-summary-types";
import { SubagentRow } from "../src/features/agents/SubagentRow";
import { SubagentSheet } from "../src/features/agents/SubagentSheet";
import { SubagentWorkspace } from "../src/features/agents/SubagentWorkspace";
import {
  projectSubagentLineage,
  projectSubagentWorkspaceItems,
} from "../src/features/agents/lineageProjection";
import { legendListScrollToIndex, setLegendListInitialRenderLimit } from "./mocks/LegendNativeList";

jest.mock("expo-file-system/legacy", () => ({
  cacheDirectory: "/cache/",
  getInfoAsync: async () => ({ exists: false }),
}));

jest.mock("../src/features/agents/SubagentDetail", () => {
  const { Pressable, Text } = jest.requireActual<typeof import("react-native")>("react-native");
  return {
    SubagentDetail({
      onBack,
      parentBreadcrumb,
    }: {
      readonly onBack: () => void;
      readonly parentBreadcrumb: string | null;
    }): React.JSX.Element {
      return (
        <Pressable accessibilityLabel="Back to subagents" onPress={onBack}>
          <Text>{parentBreadcrumb}</Text>
        </Pressable>
      );
    },
  };
});

const rootThreadId = "root";

afterEach(() => {
  legendListScrollToIndex.mockClear();
  setLegendListInitialRenderLimit(Number.POSITIVE_INFINITY);
  jest.restoreAllMocks();
});

it("restores an offscreen nested selection before returning accessibility focus", async () => {
  setLegendListInitialRenderLimit(3);
  const focus = jest.spyOn(AccessibilityInfo, "setAccessibilityFocus");
  const details = createThreadDetailDatabase();
  const direct = summary("direct", rootThreadId, "Direct", 10);
  const summaries = [
    direct,
    summary("sibling-1", rootThreadId, "Sibling 1", 9),
    summary("sibling-2", rootThreadId, "Sibling 2", 8),
    summary("sibling-3", rootThreadId, "Sibling 3", 7),
    summary("nested", direct.remoteThreadId, "Nested", 1),
  ];
  const view = render(
    <SubagentSheet
      connectionId="server"
      initialThreadId="nested"
      onClose={jest.fn()}
      parentLabel="Root"
      parentThreadId={rootThreadId}
      renderThread={() => null}
      summaries={summaries}
      threadDetails={details}
    />,
    { createNodeMock: () => ({}) },
  );

  act(() => {
    fireEvent(view.getByTestId("subagent-workspace"), "layout", {
      nativeEvent: { layout: { width: 400 } },
    });
  });
  expect(
    view.queryByLabelText("Open subagent Nested, child of Direct, depth 2 under Root"),
  ).toBeNull();

  fireEvent.press(view.getByLabelText("Back to subagents"));

  await waitFor(() => {
    expect(legendListScrollToIndex).toHaveBeenCalledWith({
      animated: false,
      index: 6,
      viewPosition: 0.5,
    });
  });
  await waitFor(() => {
    expect(
      view.getByLabelText("Open subagent Nested, child of Direct, depth 2 under Root"),
    ).toBeVisible();
  });
  const nestedRow = view
    .UNSAFE_getAllByType(SubagentRow)
    .find((row) => row.props.summary.remoteThreadId === "nested");
  if (nestedRow === undefined || typeof nestedRow.props.focusRef !== "function") {
    throw new Error("Expected the restored native row ref callback");
  }
  // React Test Renderer does not materialize host refs; invoking the real row callback models
  // the native host mount that follows LegendList's offscreen scroll.
  act(() => {
    nestedRow.props.focusRef(42);
  });
  expect(focus).toHaveBeenCalledTimes(1);
  expect(legendListScrollToIndex.mock.invocationCallOrder[0]).toBeLessThan(
    focus.mock.invocationCallOrder[0] ?? Number.POSITIVE_INFINITY,
  );
  details.close();
});

it("keeps authoritative orphan and cycle members ordinary, openable, and root-scoped", () => {
  const details = createThreadDetailDatabase();
  const orphan = summary("orphan", "missing", "Orphan", 5);
  const cycleA = summary("cycle-a", "cycle-b", "Cycle A", 4);
  const cycleB = summary("cycle-b", "cycle-a", "Cycle B", 3);
  const unrelated = {
    ...summary("other", "other-root", "Other", 2),
    subagentRootThreadId: "other-root",
  };
  const view = render(
    <SubagentSheet
      connectionId="server"
      onClose={jest.fn()}
      parentLabel="Root"
      parentThreadId={rootThreadId}
      renderThread={() => null}
      summaries={[orphan, cycleA, cycleB, unrelated]}
      threadDetails={details}
    />,
  );

  const orphanRow = view.getByLabelText("Open subagent Orphan, lineage unavailable");
  expect(view.getByLabelText("Open subagent Cycle A, lineage unavailable")).toBeVisible();
  expect(view.getByLabelText("Open subagent Cycle B, lineage unavailable")).toBeVisible();
  expect(view.queryByLabelText("Open subagent Other, lineage unavailable")).toBeNull();
  fireEvent.press(orphanRow);
  expect(view.getByLabelText("Back to subagents")).toBeVisible();
  details.close();
});

it("visibly ends known lineage around unknown rows without inventing ancestry", () => {
  const knownBefore = summary("known-before", rootThreadId, "Known before", 5);
  const unknown = summary("unknown", "missing", "Unknown", 4);
  const knownAfter = summary("known-after", rootThreadId, "Known after", 3);
  const rows = projectSubagentLineage([knownBefore, unknown, knownAfter], rootThreadId, "Root");
  const view = render(
    <SubagentWorkspace
      compact={false}
      detailOpen={false}
      masterWidth={320}
      onClose={jest.fn()}
      onLayout={jest.fn()}
      onSelect={jest.fn()}
      restoreFocusThreadId={null}
      selected={null}
      subagents={rows}
    >
      {null}
    </SubagentWorkspace>,
  );

  expect(view.getAllByTestId("subagent-lineage-boundary")).toHaveLength(2);
  expect(view.queryByText("Lineage unavailable")).toBeNull();
  expect(
    view.UNSAFE_getAllByType(SubagentRow).map((row) => row.props.summary.remoteThreadId),
  ).toEqual(["known-before", "unknown", "known-after"]);
  expect(view.getByLabelText("Open subagent Unknown, lineage unavailable")).toBeVisible();
});

it("keeps same-named parent groups distinct by their thread identity", () => {
  const parentA = summary("parent-a", rootThreadId, "Review", 6);
  const parentB = summary("parent-b", rootThreadId, "Review", 5);
  const childA = summary("child-a", parentA.remoteThreadId, "Child A", 4);
  const childB = summary("child-b", parentB.remoteThreadId, "Child B", 3);
  const items = projectSubagentWorkspaceItems(
    projectSubagentLineage([parentA, parentB, childA, childB], rootThreadId, "Root"),
  );

  expect(
    items
      .filter((item) => item.kind === "section" && item.label === "Root › Review")
      .map((item) => (item.kind === "section" ? item.parentThreadIds : [])),
  ).toEqual([
    [rootThreadId, "parent-a"],
    [rootThreadId, "parent-b"],
  ]);
});

it("does not derive lineage identity from the visible breadcrumb delimiter", () => {
  const delimiterParent = summary("delimiter-parent", rootThreadId, "A › B", 8);
  const parentA = summary("parent-a", rootThreadId, "A", 7);
  const parentB = summary("parent-b", parentA.remoteThreadId, "B", 6);
  const delimiterChild = summary(
    "delimiter-child",
    delimiterParent.remoteThreadId,
    "Delimiter child",
    5,
  );
  const nestedChild = summary("nested-child", parentB.remoteThreadId, "Nested child", 4);
  const items = projectSubagentWorkspaceItems(
    projectSubagentLineage(
      [delimiterParent, parentA, parentB, delimiterChild, nestedChild],
      rootThreadId,
      "Root",
    ),
  );

  expect(
    items
      .filter((item) => item.kind === "section" && item.label === "Root › A › B")
      .map((item) => (item.kind === "section" ? item.parentThreadIds : [])),
  ).toEqual([
    [rootThreadId, "delimiter-parent"],
    [rootThreadId, "parent-a", "parent-b"],
  ]);
});

function summary(
  remoteThreadId: string,
  parentThreadId: string,
  agentNickname: string,
  updatedAt: number,
): StoredThreadSummary {
  return {
    agentNickname,
    agentRole: "worker",
    archived: false,
    connectionId: "server",
    cwd: "/repo",
    deleteCommandId: null,
    lastSeenCursor: 0,
    latestActivityCursor: 0,
    name: null,
    parentThreadId,
    pendingRequestCount: 0,
    pinned: false,
    preview: `${agentNickname} preview`,
    recencyAt: null,
    remoteThreadId,
    status: { type: "idle" },
    subagentRootThreadId: rootThreadId,
    unread: 0,
    updatedAt,
  };
}
