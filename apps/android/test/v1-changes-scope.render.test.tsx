import { render, waitFor } from "@testing-library/react-native";

import { createThreadResourcesModel } from "../src/data/thread-resources-model";
import type {
  ThreadChangeScope,
  ThreadResourcesValue,
} from "../src/data/workspace-resource-database";
import { ThreadResourceContextChips } from "../src/features/changes/ThreadResourceContextChips";
import type { ChangesPreferences } from "../src/features/changes/changePresentation";

const SCOPES: ThreadChangeScope[] = ["session", "lastTurn", "staged", "unstaged", "branch"];

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
      name: "No changes, Branch. Long press to choose changes scope.",
    }),
  ).toBeVisible();

  view.rerender(<ThreadResourceContextChips {...common} preferences={preferences("session")} />);

  await waitFor(() => expect(calls).toEqual(["branch", "session"]));
  expect(
    view.getByRole("button", {
      name: "Changes · 1, Session. Long press to choose changes scope.",
    }),
  ).toBeVisible();
});
