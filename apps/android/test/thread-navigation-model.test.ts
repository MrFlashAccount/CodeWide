import { describe, expect, it } from "vitest";

import { createThreadNavigationModel } from "../src/data/thread-navigation-model";
import { SearchConversationWindow } from "../src/search/search-conversation-window";

function searchWindow() {
  return new SearchConversationWindow(
    {
      connectionId: "server",
      hit: {
        messageId: 20,
        threadId: "chat",
        turnId: "turn-20",
        title: "Chat",
        project: "/project",
        timestamp: "2026-09-06T10:00:00Z",
        sourceOffset: 2000,
        kind: "agent_message",
        excerpt: "Answer",
      },
    },
    "answer",
    async () => ({ messages: [], turns: [], older: null, newer: null }),
  );
}

describe("thread navigation model", () => {
  it("keeps repeated selection stable unless an explicit reload is requested", () => {
    const model = createThreadNavigationModel();

    expect(model.current()).toEqual({ id: null, generation: 0 });
    const selected = model.select("server\u0000thread");
    expect(selected).toEqual({ id: "server\u0000thread", generation: 1 });
    expect(model.select("server\u0000thread")).toBe(selected);
    expect(model.select("server\u0000thread", true)).toEqual({
      id: "server\u0000thread",
      generation: 2,
    });
  });

  it("publishes one scalar selection that rows can observe independently", () => {
    const model = createThreadNavigationModel();
    const ids: Array<string | null> = [];
    const dispose = model.selection$.id.onChange(({ value }) => ids.push(value));

    model.select("server\u0000first");
    model.select("server\u0000second");
    dispose();

    expect(ids).toEqual(["server\u0000first", "server\u0000second"]);
  });

  it("opens search atomically and does not carry its window into the next chat", () => {
    const model = createThreadNavigationModel();
    const window = searchWindow();
    model.openDraft({ id: "draft", serverId: "server", cwd: "/project", workspaceMode: "current" });
    const published: string[] = [];
    const dispose = model.destination$.onChange(({ value }) => published.push(value.kind));
    model.openSearch("server\u0000chat", window);
    const destination = model.destination$.peek();
    expect(destination.kind).toBe("thread");
    if (destination.kind !== "thread") throw new Error("Expected search destination");
    expect(destination.searchWindow).toBe(window);
    expect(model.current().id).toBe("server\u0000chat");
    expect(published).toEqual(["thread"]);
    model.select("server\u0000another");
    expect(model.destination$.peek()).toMatchObject({
      kind: "thread",
      key: "server\u0000another",
      searchWindow: null,
    });
    dispose();
  });

  it("returns from search to the live tail without changing the selected chat or reload generation", () => {
    const model = createThreadNavigationModel();
    model.openSearch("server\u0000chat", searchWindow());
    const before = model.current();
    model.exitSearch();
    expect(model.current()).toEqual(before);
    expect(model.destination$.peek()).toMatchObject({
      kind: "thread",
      key: before.id,
      searchWindow: null,
    });
  });

  it("keeps draft edits scoped and clears the draft on back or thread selection", () => {
    const model = createThreadNavigationModel();
    model.openDraft({ id: "first", serverId: "server", cwd: null, workspaceMode: "current" });
    model.changeDraftProject("first", "/project");
    model.changeDraftWorkspaceMode("first", "isolated");
    expect(model.destination$.peek()).toMatchObject({
      kind: "draft",
      draft: { cwd: "/project", workspaceMode: "isolated" },
    });
    model.openDraft({ id: "second", serverId: "other", cwd: null, workspaceMode: "current" });
    const second = model.destination$.peek();
    model.changeDraftProject("first", "/stale");
    model.changeDraftWorkspaceMode("first", "isolated");
    expect(model.destination$.peek()).toBe(second);
    model.select(null);
    expect(model.destination$.peek().kind).toBe("empty");
    model.openDraft({ id: "third", serverId: "server", cwd: null, workspaceMode: "current" });
    model.select("server\u0000chat");
    expect(model.destination$.peek()).toMatchObject({ kind: "thread", key: "server\u0000chat" });
    expect(model.current().id).toBe("server\u0000chat");
  });
});
