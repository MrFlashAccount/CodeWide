import { fireEvent, render, waitFor } from "@testing-library/react-native";

import { createThreadResourcesModel } from "../src/data/thread-resources-model";
import type {
  ThreadChangeScope,
  ThreadResourcesValue,
} from "../src/data/workspace-resource-database";
import { ThreadResourceContextChips } from "../src/features/changes/ThreadResourceContextChips";
import type { ChangesPreferences } from "../src/features/changes/changePresentation";
import { colors } from "../src/theme";
import { getAppDialogRequest, resetAppDialog } from "./mocks/AppDialog";

const SCOPES: ThreadChangeScope[] = ["session", "uncommitted", "branch"];

function preferences(scope: ThreadChangeScope): ChangesPreferences {
  return { mode: "unified", scope, wrapLines: false };
}

it("reloads and displays the selected Changes scope without remounting", async () => {
  const model = createThreadResourcesModel();
  const calls: Array<ThreadChangeScope | undefined> = [];
  const load = async (scope?: ThreadChangeScope): Promise<ThreadResourcesValue> => {
    calls.push(scope);
    const value: ThreadResourcesValue = {
      attachments: [],
      changeScope: scope ?? "branch",
      changeScopes: SCOPES,
      changes:
        scope === "session"
          ? [
              {
                additions: 1,
                availability: "available",
                deletions: 0,
                itemId: "edit-1",
                kind: "update",
                path: "/workspace/file.ts",
                turnId: "turn-1",
              },
            ]
          : [],
      revision: `${scope ?? "branch"}-r1`,
      threadId: "thread",
    };
    model.put({
      connectionId: "server",
      error: null,
      id: "server\u0000thread",
      status: "ready",
      threadId: "thread",
      updatedAt: calls.length,
      value,
    });
    return value;
  };
  const common = {
    load,
    model,
    onOpen: jest.fn(),
    onPreferencesChange: jest.fn(),
    resourceId: "server\u0000thread",
    revision: "live",
  };
  const view = render(
    <ThreadResourceContextChips {...common} preferences={preferences("branch")} />,
  );

  await waitFor(() => expect(calls).toEqual(["branch"]));
  expect(
    view.getByRole("button", {
      name: "Changes, Branch · 0. Long press to choose changes scope.",
    }),
  ).toBeVisible();

  view.rerender(<ThreadResourceContextChips {...common} preferences={preferences("session")} />);

  await waitFor(() => expect(calls).toEqual(["branch", "session"]));
  expect(
    view.getByRole("button", {
      name: "Changes, Session · 1. Long press to choose changes scope.",
    }),
  ).toBeVisible();

  view.rerender(
    <ThreadResourceContextChips {...common} preferences={preferences("uncommitted")} />,
  );

  await waitFor(() => expect(calls).toEqual(["branch", "session", "uncommitted"]));
  expect(
    view.getByRole("button", {
      name: "Changes, Uncommitted · 0. Long press to choose changes scope.",
    }),
  ).toBeVisible();
});

it("does not send a restored scope until this provider advertises it", async () => {
  const model = createThreadResourcesModel();
  const calls: Array<ThreadChangeScope | undefined> = [];
  const load = async (scope?: ThreadChangeScope): Promise<ThreadResourcesValue> => {
    calls.push(scope);
    const value: ThreadResourcesValue = {
      attachments: [],
      changeScope: "branch",
      changeScopes: ["session", "branch"],
      changes: [
        {
          additions: 1,
          availability: "available",
          deletions: 0,
          itemId: "edit-1",
          kind: "update",
          path: "/workspace/file.ts",
          turnId: "turn-1",
        },
      ],
      revision: "arc-branch-r1",
      threadId: "thread",
    };
    model.put({
      connectionId: "server",
      error: null,
      id: "server\u0000thread",
      status: "ready",
      threadId: "thread",
      updatedAt: calls.length,
      value,
    });
    return value;
  };

  const view = render(
    <ThreadResourceContextChips
      load={load}
      model={model}
      onOpen={jest.fn()}
      onPreferencesChange={jest.fn()}
      preferences={preferences("uncommitted")}
      resourceId={"server\u0000thread"}
      revision="live"
    />,
  );

  await waitFor(() =>
    expect(
      view.getByRole("button", {
        name: "Changes, Branch · 1. Long press to choose changes scope.",
      }),
    ).toBeVisible(),
  );
  expect(calls).toEqual([undefined]);
});

it("keeps a failed Changes chip visible and red without hiding healthy attachments", () => {
  resetAppDialog();
  const model = createThreadResourcesModel();
  model.put({
    connectionId: "server",
    error: "Arc plugin rejected the change scope",
    id: "server\u0000thread",
    pendingKinds: [],
    readyKinds: ["attachments"],
    resourceErrors: { changes: "Arc plugin rejected the change scope" },
    status: "error",
    threadId: "thread",
    updatedAt: 1,
    value: {
      attachments: [
        {
          itemId: "attachment-1",
          key: "key",
          kind: "file",
          name: "file.txt",
          origin: "user",
          path: "/workspace/file.txt",
          turnId: "turn-1",
          url: null,
        },
      ],
      changeScope: "branch",
      changeScopes: ["session", "branch"],
      changes: [],
      revision: "previous",
      threadId: "thread",
    },
  });
  const view = render(
    <ThreadResourceContextChips
      load={async () => new Promise<ThreadResourcesValue>(() => undefined)}
      model={model}
      onOpen={jest.fn()}
      onPreferencesChange={jest.fn()}
      preferences={preferences("uncommitted")}
      resourceId={"server\u0000thread"}
      revision="live"
    />,
  );

  const changes = view.getByRole("button", {
    name: "Changes unavailable. Long press to choose changes scope.",
  });
  expect(changes).toHaveStyle({ backgroundColor: colors.errorContainer, borderColor: colors.red });
  expect(view.getByText("Changes unavailable")).toHaveStyle({ color: colors.red });
  expect(view.getByRole("button", { name: "Attachments · 1" })).toBeVisible();
  fireEvent.press(changes);
  expect(getAppDialogRequest()).toMatchObject({
    message: "Arc plugin rejected the change scope",
    title: "Changes unavailable",
  });
});
