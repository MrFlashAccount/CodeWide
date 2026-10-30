import { act, render, within } from "@testing-library/react-native";

import { parsePullRequestListPage } from "../src/data/forgePullRequestContract";
import { ProjectUnreadModel, threadUnreadReader } from "../src/data/project-unread-model";
import { LinkedChatButton } from "../src/features/pullRequestDetail/LinkedChatButton";
import { PullRequestRow } from "../src/features/pullRequests/list/PullRequestRow";
import { threadId } from "../src/data/reviewContract";
import { connectedAccount, listRow } from "./fixtures/forgeWireFixtures";
import { summary } from "./fixtures/thread-summary";

// Sergey's contract: an unread agent reply in a PR's canonical review chat is shown only on the PR
// screen's explicit chat button and clears once read; the PR list row never marks it.

const SEEN = { revision: "b".repeat(64), state: "seen" };

function parsedRow(overrides: Record<string, unknown>) {
  const row = parsePullRequestListPage({
    category: "reviewRequested",
    fetchedAt: "2026-10-21T09:48:00Z",
    nextCursor: null,
    repositories: ["MrFlashAccount/CodeWide"],
    sections: [
      {
        account: connectedAccount,
        rows: [listRow("7", overrides)],
        supportedCategories: ["reviewRequested"],
      },
    ],
  })?.sections[0]?.rows[0];
  if (row === undefined) {
    throw new Error("The pull-request row fixture is invalid");
  }
  return row;
}

async function unreadIndex(...unreadThreads: readonly string[]): Promise<ProjectUnreadModel> {
  const model = new ProjectUnreadModel();
  await model.resource(async () => unreadThreads.map((id) => summary(id, { unread: 1 })));
  return model;
}

function renderRow(overrides: Record<string, unknown>) {
  const row = parsedRow(overrides);
  const view = render(
    <PullRequestRow
      icon={null}
      nowMs={Date.parse(row.updatedAt)}
      onPress={() => undefined}
      row={row}
    />,
  );
  return within(view.getByTestId(`pull-request-row-${row.number}`));
}

it("keeps the linked review chat's unread state off the PR row; only forge activity marks it", () => {
  const seen = renderRow({ attention: SEEN, reviewThreadId: "review-chat" });

  expect(seen.queryByLabelText("Agent replied")).toBeNull();
  expect(seen.queryByLabelText("New activity")).toBeNull();

  const fresh = renderRow({ reviewThreadId: "review-chat" });
  expect(fresh.getByLabelText("New activity")).toBeOnTheScreen();
  expect(fresh.queryByLabelText("Agent replied")).toBeNull();
});

it("treats a row from an older Companion as having no canonical review chat", () => {
  const { reviewThreadId: _omitted, ...legacy } = listRow("7");
  const row = parsePullRequestListPage({
    category: "reviewRequested",
    fetchedAt: "2026-10-21T09:48:00Z",
    nextCursor: null,
    repositories: [],
    sections: [{ account: connectedAccount, rows: [legacy], supportedCategories: [] }],
  })?.sections[0]?.rows[0];

  expect(row?.reviewThreadId).toBeNull();
});

function renderChatButton(model: ProjectUnreadModel, reviewThreadId: string | null) {
  return render(
    <LinkedChatButton
      disabled={false}
      isThreadUnread={threadUnreadReader(model, "server")}
      label="Open linked review chat: Review"
      onPress={() => undefined}
      reviewThreadId={reviewThreadId === null ? null : threadId(reviewThreadId, "reviewThreadId")}
    />,
  );
}

it("badges the chat button while the canonical chat is unread and clears it once read", async () => {
  const model = await unreadIndex("review-chat");
  const view = renderChatButton(model, "review-chat");

  expect(view.getByTestId("pull-request-linked-chat-unread")).toBeOnTheScreen();
  expect(view.getByLabelText("Open linked review chat: Review, new agent reply")).toBeOnTheScreen();

  act(() => {
    model.publish([{ type: "update", value: summary("review-chat") }]);
  });
  expect(view.queryByTestId("pull-request-linked-chat-unread")).toBeNull();
  expect(view.getByLabelText("Open linked review chat: Review")).toBeOnTheScreen();
  model.close();
});

it("does not badge the chat button before the PR has a canonical chat", async () => {
  const model = await unreadIndex("unrelated-chat");
  const view = renderChatButton(model, null);

  expect(view.queryByTestId("pull-request-linked-chat-unread")).toBeNull();
  model.close();
});
