import { fireEvent, render } from "@testing-library/react-native";

import type { StoredThreadSummary } from "../src/data/thread-summary-types";
import { colors, radii } from "../src/theme";
import { SubagentWorkspace } from "../src/ui/SubagentWorkspace";

const summary: StoredThreadSummary = {
  connectionId: "buddy",
  remoteThreadId: "subagent-1",
  parentThreadId: "parent-1",
  agentNickname: "Builder",
  agentRole: "worker",
  name: "Implementation",
  preview: "**Implement the compact sidebar**",
  cwd: "/repo",
  updatedAt: 1_787_000_000,
  recencyAt: null,
  status: { type: "idle" },
  pinned: false,
  archived: false,
  pendingRequestCount: 0,
  latestActivityCursor: 2,
  lastSeenCursor: 1,
  unread: 1,
  deleteCommandId: null,
};

it("uses the thread-sidebar geometry and real subagent preview", () => {
  const view = render(
    <SubagentWorkspace
      subagents={[summary]}
      selected={summary}
      onSelect={jest.fn()}
      onBack={jest.fn()}
      onClose={jest.fn()}
      renderDetail={() => null}
    />,
  );

  fireEvent(view.getByTestId("subagent-workspace"), "layout", {
    nativeEvent: { layout: { width: 1_000 } },
  });

  const row = view.getByLabelText("Open subagent Builder");
  expect(row.props.accessibilityState).toEqual({ selected: true });
  expect(row).toHaveStyle({
    height: 64,
    marginHorizontal: 8,
    marginVertical: 2,
    borderRadius: radii.selected,
    backgroundColor: colors.secondaryContainer,
  });
  expect(view.getByText("Implement the compact sidebar")).toBeVisible();
  expect(view.queryByText("worker · idle")).toBeNull();
  expect(view.getByLabelText("1 unread message")).toBeVisible();
  expect(view.getByLabelText("1 subagent")).toBeVisible();
  expect(view.queryByText("newest activity first")).toBeNull();
});
