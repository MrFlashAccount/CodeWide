import { notifyManager, QueryClient } from "@tanstack/react-query";
import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react-native";
import { RpcResponseError } from "@codewide/sync-client";
import type { ReactNode } from "react";

import { createForgeCheckTriggers } from "../src/data/forgeCheckTriggers";
import { headRevision, parsePullRequestKeyParam } from "../src/data/forgeContract";
import type { CheckItem } from "../src/data/forgePullRequestContract";
import { ChecksStatusRow } from "../src/features/pullRequestDetail/overview/ChecksStatusRow";
import {
  ManualTriggerAccessContext,
  type ManualTriggerAccess,
} from "../src/features/pullRequestDetail/overview/ManualTriggersContext";

// Only replace the native sheet windows; real query, mutation, scroll-list and picker owners stay mounted.
jest.mock("@expo/ui/jetpack-compose", () => {
  const { View } = jest.requireActual<typeof import("react-native")>("react-native");
  return {
    ...jest.requireActual<typeof import("@expo/ui/jetpack-compose")>("@expo/ui/jetpack-compose"),
    // Compose presents its dialog in a separate native window outside the inert RN host.
    Host: ({ children }: { readonly children: ReactNode }) => <>{children}</>,
    ModalBottomSheet: ({
      children,
      onDismissRequest,
    }: {
      readonly children: ReactNode;
      readonly onDismissRequest: () => void;
    }) => <View onAccessibilityEscape={onDismissRequest}>{children}</View>,
    RNHostView: View,
  };
});

const READ = "companion/pullRequest/checkTriggers/read";
const WRITE = "companion/pullRequest/action/run";
const head = headRevision("head-a", "headRevision");
const pr = parsePullRequestKeyParam("fpr1.github-91");
if (pr === null) throw new Error("Invalid fixture PR");
const target = { connectionId: "lab", headRevision: head, pullRequest: pr };
function command(checkId: string, id: string, label: string) {
  return {
    actionId: id,
    anchor: { kind: "checks", checkId },
    availability: { state: "enabled" },
    confirm: "none",
    group: "checks",
    input: null,
    isDefault: false,
    kind: "manualTrigger",
    label,
    order: 1,
    placement: "secondary",
    toggle: null,
  };
}
const commands = [
  command("build", "execute", "Run tests"),
  command("build", "skip", "Skip tests"),
  command("smoke", "one", "Approve stage"),
];
function job(id: string): CheckItem {
  return {
    activity: "inactive",
    checkId: id,
    detailsUrl: null,
    durationSeconds: null,
    name: id,
    onDemand: true,
    required: false,
    state: "skipped",
    viewerUrl: null,
  };
}
const jobs = [job("smoke"), job("build")];
const slots = {
  anchored: {
    checks: new Map(),
    checksSection: [],
    conflict: [],
    files: new Map(),
    reviewThreads: new Map(),
  },
};

function screenAt(access: ManualTriggerAccess | null) {
  return (
    <ManualTriggerAccessContext.Provider value={access}>
      <ChecksStatusRow
        checks={{ detail: "No running checks", title: "Checks", tone: "neutral" }}
        divided={false}
        host="forge.example"
        items={jobs}
        onRun={() => undefined}
        pending={{}}
        pendingToggles={{}}
        slots={slots}
      />
    </ManualTriggerAccessContext.Provider>
  );
}
const clients: QueryClient[] = [];
function fixture(writeGate: Promise<void> = Promise.resolve()) {
  const client = new QueryClient();
  clients.push(client);
  let rejectReads = false;
  const writes: unknown[] = [];
  const call = jest.fn(async (_id: string, method: string, params: unknown) => {
    if (method === READ) {
      if (rejectReads) throw new RpcResponseError(-32084, "Manual actions unavailable");
      return { actions: commands, headRevision: head };
    }
    if (method !== WRITE) throw new Error(method);
    writes.push(params);
    await writeGate;
    if (
      typeof params === "object" &&
      params !== null &&
      "actionId" in params &&
      params.actionId === "skip"
    )
      throw new RpcResponseError(-32083, "Forge write outcome is unknown", {
        kind: "outcomeUnknown",
      });
    return { catalog: null, message: "Started", openUrl: null, runId: "ok" };
  });
  const resource = createForgeCheckTriggers({ call, client, report: () => undefined });
  return {
    access: { resource, target },
    call,
    denyReads: () => {
      rejectReads = true;
    },
    writes,
  };
}
beforeAll(() => {
  // TanStack delivers query and mutation notifications on its scheduler, outside fireEvent's act.
  notifyManager.setNotifyFunction((notify) => act(notify));
});
afterAll(() => {
  notifyManager.setNotifyFunction((notify) => notify());
});
afterEach(async () => {
  cleanup();
  await act(async () => {
    for (const client of clients.splice(0)) client.clear();
  });
});
function openChecks() {
  fireEvent.press(screen.getByTestId("pull-request-status-checks-toggle"));
  fireEvent.press(screen.getByTestId("pull-request-status-checks-all"));
}

it("does not discover before the user opens Checks or on an unsupported provider", async () => {
  const { access, call } = fixture();
  const view = render(screenAt(null));
  openChecks();
  expect(call).not.toHaveBeenCalled();
  view.unmount();
  render(screenAt(access));
  expect(call).not.toHaveBeenCalled();
  openChecks();
  await waitFor(() =>
    expect(call).toHaveBeenCalledWith("lab", READ, { headRevision: head, pullRequest: pr }),
  );
});

it("opens a nested chooser even for one action, preserves the parent's search, and runs only an explicit selection", async () => {
  const { access, call, writes } = fixture();
  render(screenAt(access));
  openChecks();
  // The overall summary stays on the PR screen; the two sheets each have a single heading.
  expect(screen.getAllByText("No running checks")).toHaveLength(1);
  fireEvent.changeText(screen.getByTestId("pull-request-checks-search"), "smoke");
  const entry = await screen.findByRole("button", { name: "Manual actions for smoke" });
  fireEvent.press(entry);
  expect(screen.getByRole("header", { name: "Manual Actions" })).toBeOnTheScreen();
  expect(screen.getByTestId("pull-request-checks-trigger-run")).toBeDisabled();
  expect(writes).toEqual([]);
  fireEvent(screen.getByRole("header", { name: "Manual Actions" }), "accessibilityEscape");
  expect(screen.getByTestId("pull-request-checks-search")).toHaveProp("value", "smoke");
  expect(screen.queryByTestId("pull-request-checks-job-build")).toBeNull();
  fireEvent.press(entry);
  fireEvent.press(screen.getByTestId("pull-request-checks-trigger-option-one"));
  const run = screen.getByTestId("pull-request-checks-trigger-run");
  expect(within(run).getByText("Approve stage")).toBeOnTheScreen();
  fireEvent.press(run);
  await waitFor(() => expect(screen.queryByRole("header", { name: "Manual Actions" })).toBeNull());
  expect(screen.getByTestId("pull-request-checks-search")).toHaveProp("value", "smoke");
  fireEvent.press(await screen.findByRole("button", { name: "Manual action results for smoke" }));
  await screen.findByText("Started");
  expect(writes).toEqual([
    expect.objectContaining({
      actionId: "one",
      headRevision: head,
      idempotencyKey: expect.any(String),
      pullRequest: pr,
      triggerCheckId: "smoke",
    }),
  ]);
  expect(call.mock.calls.filter(([, method]) => method === WRITE)).toHaveLength(1);
});

it("sends independent choices including skip; reports partial and uncertain outcomes without retrying on reopen", async () => {
  const { access, writes } = fixture();
  render(screenAt(access));
  openChecks();
  fireEvent.press(screen.getByTestId("pull-request-checks-other"));
  const entry = await screen.findByTestId("pull-request-checks-manual-build");
  fireEvent.press(entry);
  fireEvent.press(screen.getByTestId("pull-request-checks-trigger-run"));
  expect(writes).toEqual([]);
  fireEvent.press(screen.getByText("Select all"));
  expect(screen.getByRole("checkbox", { name: "Skip tests" })).toBeChecked();
  fireEvent.press(screen.getByText("Clear selection"));
  expect(screen.getByRole("checkbox", { name: "Run tests" })).not.toBeChecked();
  fireEvent.press(screen.getByRole("checkbox", { name: "Run tests" }));
  fireEvent.press(screen.getByRole("checkbox", { name: "Skip tests" }));
  const confirm = screen.getByTestId("pull-request-checks-trigger-run");
  expect(within(confirm).getByText("Run 2 actions")).toBeOnTheScreen();
  fireEvent.press(confirm);
  await screen.findByText("Started");
  await screen.findByText(/Outcome unknown/u);
  expect(writes).toHaveLength(2);
  expect(writes[0]).toMatchObject({
    actionId: "execute",
    triggerCheckId: "build",
    pullRequest: pr,
  });
  expect(writes[1]).toMatchObject({ actionId: "skip", triggerCheckId: "build", pullRequest: pr });
  const keys = writes.map((write) =>
    typeof write === "object" && write !== null && "idempotencyKey" in write
      ? write.idempotencyKey
      : null,
  );
  expect(keys.every((key) => typeof key === "string")).toBe(true);
  expect(new Set(keys).size).toBe(2);
  fireEvent(screen.getByRole("header", { name: "Manual Actions" }), "accessibilityEscape");
  fireEvent.press(entry);
  expect(screen.getByRole("checkbox", { name: "Skip tests" })).toBeDisabled();
  expect(screen.getByRole("checkbox", { name: "Run tests" })).toBeDisabled();
  expect(writes).toHaveLength(2);
});

it("keeps cached actions on discovery failure, and blocks a picker opened on a previous head", async () => {
  const { access, denyReads, writes } = fixture();
  const view = render(screenAt(access));
  openChecks();
  fireEvent.press(screen.getByTestId("pull-request-checks-other"));
  const entry = await screen.findByTestId("pull-request-checks-manual-smoke");
  denyReads();
  fireEvent.press(entry);
  await screen.findByText("Manual actions unavailable");
  expect(screen.getByTestId("pull-request-checks-job-smoke")).toBeOnTheScreen();
  expect(screen.getByTestId("pull-request-checks-trigger-option-one")).toBeOnTheScreen();
  expect(screen.getByTestId("pull-request-checks-trigger-run")).toBeDisabled();
  await act(async () => {
    view.rerender(
      screenAt({
        ...access,
        target: { ...target, headRevision: headRevision("head-b", "headRevision") },
      }),
    );
  });
  expect(screen.getByText(/pull request changed/u)).toBeOnTheScreen();
  expect(writes).toEqual([]);
});

it("keeps a newly opened check on screen after an earlier dismissed picker succeeds", async () => {
  let release = () => undefined;
  const gate = new Promise<void>((resolve) => {
    release = () => {
      resolve();
    };
  });
  const { access, writes } = fixture(gate);
  render(screenAt(access));
  openChecks();
  fireEvent.press(screen.getByTestId("pull-request-checks-other"));
  fireEvent.press(await screen.findByTestId("pull-request-checks-manual-smoke"));
  fireEvent.press(screen.getByTestId("pull-request-checks-trigger-option-one"));
  fireEvent.press(screen.getByTestId("pull-request-checks-trigger-run"));
  await waitFor(() => expect(writes).toHaveLength(1));
  fireEvent(screen.getByRole("header", { name: "Manual Actions" }), "accessibilityEscape");
  fireEvent.press(screen.getByTestId("pull-request-checks-manual-build"));
  await act(async () => {
    release();
    await gate;
  });
  await waitFor(() => expect(access.resource.catalog.client.isMutating()).toBe(0));
  expect(screen.getByTestId("pull-request-checks-trigger-option-skip")).toBeOnTheScreen();
});
