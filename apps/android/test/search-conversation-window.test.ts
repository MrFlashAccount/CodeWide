import { describe, expect, it, vi } from "vitest";
import type { Turn } from "@codewide/codex-protocol/v0.147.0/v2";
import type { SearchConversationPage } from "../src/data/message-search";
import { SearchConversationWindow, mergeSearchWindows } from "../src/features/search/search-conversation-window";
import { SearchSession } from "../src/features/search/search-session";

function page(start: number, count: number): SearchConversationPage {
  const messages = Array.from({ length: count }, (_, index) => ({
    messageId: start + index, turnId: `turn-${start + index}`, sourceOffset: (start + index) * 100,
    timestamp: "2026-09-06T10:00:00Z", kind: "agent_message" as const, text: "Repeated answer",
  }));
  const turns: Turn[] = messages.map(message => ({
    id: message.turnId, items: [{ type: "agentMessage", id: `search-message:${message.messageId}`, text: message.text, phase: null, memoryCitation: null }],
    itemsView: "summary", status: "completed", error: null, startedAt: 1, completedAt: 2, durationMs: 1000,
  }));
  return { messages, turns, older: start > 1 ? start : null, newer: start + count };
}

const target = { connectionId: "server", hit: {
  messageId: 20, threadId: "chat", turnId: "turn-20", title: "Chat", project: "/project",
  timestamp: "2026-09-06T10:00:00Z", sourceOffset: 2000, kind: "agent_message" as const, excerpt: "Repeated answer",
} };

describe("historical search viewport", () => {
  it("fills short search pages without another edge gesture and preserves the selected turn", async () => {
    const load = vi.fn()
      .mockResolvedValueOnce(page(20, 1))
      .mockResolvedValueOnce(page(19, 1))
      .mockResolvedValueOnce(page(18, 1));
    let height = 100;
    const window = new SearchConversationWindow(target, "answer", load, async () => {
      height += 100;
      void window.reportViewport(300, height);
    });
    await window.read();
    await window.reportViewport(300, height);
    expect(load.mock.calls.map(([, query]) => query.direction)).toEqual(["around", "older", "older"]);
    expect(window.state$.peek().page?.turns.map(turn => turn.id)).toEqual(["turn-18", "turn-19", "turn-20"]);
    expect(window.messageItemId).toBe("search-message:20");
  });

  it("stops automatic search filling on a repeated boundary", async () => {
    const load = vi.fn().mockResolvedValue(page(20, 1));
    const window = new SearchConversationWindow(target, "answer", load, async () => {});
    await window.read();
    await window.reportViewport(500, 100);
    await window.reportViewport(500, 110);
    expect(load).toHaveBeenCalledTimes(2);
  });

  it("does not continue loading the search window after it is left", async () => {
    const load = vi.fn().mockResolvedValueOnce(page(20, 1)).mockResolvedValue(page(19, 1));
    const window = new SearchConversationWindow(target, "answer", load, async () => {
      window.cancelViewportFill();
    });
    await window.read();
    await window.reportViewport(500, 100);
    expect(load).toHaveBeenCalledTimes(2);
  });

  it("uses message identity and fetches the requested old position exactly once", async () => {
    const load = vi.fn().mockResolvedValue(page(15, 12));
    const window = new SearchConversationWindow(target, "answer", load);
    await Promise.all([window.read(), window.read()]);
    expect(load).toHaveBeenCalledExactlyOnceWith("server", { threadId: "chat", messageId: 20, direction: "around" });
    expect(window.messageItemId).toBe("search-message:20");
    expect(window.state$.peek().page?.turns.find(turn => turn.id === "turn-20")?.items[0]?.id).toBe("search-message:20");
    await window.read();
    expect(load).toHaveBeenCalledTimes(1);
  });

  it("keeps surrounding messages on pagination and bounds residency in both directions", () => {
    const newer = mergeSearchWindows(page(1, 12), page(10, 12), "newer");
    expect(newer.turns).toHaveLength(15);
    expect(newer.turns.map(turn => turn.id)).toEqual(Array.from({ length: 15 }, (_, index) => `turn-${index + 7}`));
    expect(newer.older).toBe(7);
    const older = mergeSearchWindows(newer, page(1, 10), "older");
    expect(older.turns.map(turn => turn.id)).toEqual(Array.from({ length: 15 }, (_, index) => `turn-${index + 1}`));
    expect(older.newer).toBe(15);
    expect(older.older).toBeNull();
  });

  it("loads each newly selected message in the same chat independently", async () => {
    const load = vi.fn().mockResolvedValue(page(15, 12));
    const first = new SearchConversationWindow(target, "answer", load);
    const second = new SearchConversationWindow({ ...target, hit: { ...target.hit, messageId: 21, turnId: "turn-21" } }, "answer", load);
    await first.read();
    await second.read();
    expect(load).toHaveBeenCalledTimes(2);
    expect(load).toHaveBeenLastCalledWith("server", { threadId: "chat", messageId: 21, direction: "around" });
  });

  it("surfaces stale positions and allows retry instead of substituting the chat tail", async () => {
    const load = vi.fn().mockRejectedValueOnce(new Error("Search position expired")).mockResolvedValue(page(15, 12));
    const window = new SearchConversationWindow(target, "answer", load);
    await window.read();
    expect(window.state$.peek()).toEqual({ status: "error", page: null, message: "Search position expired" });
    await window.retry();
    expect(window.state$.peek().status).toBe("ready");
    expect(load).toHaveBeenLastCalledWith("server", { threadId: "chat", messageId: 20, direction: "around" });
  });

  it("retains the exact repeated message when lazy activity supplies canonical IDs", async () => {
    const selectedPage = page(20, 1);
    const original = selectedPage.turns[0];
    if (original === undefined) throw new Error("Missing fixture turn");
    const first = { type: "agentMessage" as const, id: "search-message:19", text: "Repeated answer", phase: null, memoryCitation: null };
    const second = { ...first, id: "search-message:20" };
    const window = new SearchConversationWindow(target, "answer", vi.fn().mockResolvedValue({ ...selectedPage, turns: [{ ...original, items: [first, second] }] }));
    await window.read();
    const fullItems = [{ ...first, id: "canonical-first" }, { ...second, id: "canonical-second" }];
    window.replaceItems("turn-20", fullItems);
    expect(window.messageItemId).toBe("canonical-second");
    expect(window.state$.peek().page?.turns[0]?.items).toBe(fullItems);
    expect(window.state$.peek().page?.turns[0]?.itemsView).toBe("full");
  });
});

describe("workspace-owned search session", () => {
  it("validates filters before applying and retains draft/scroll independent of component lifetime", () => {
    const session = new SearchSession("test");
    session.changeText("needle");
    session.filters$.set({ serverId: "", threadId: "", project: "", from: "2026-02-30", until: "" });
    expect(session.submit()).toBe(false);
    expect(session.request$.peek()).toBeNull();
    session.filters$.from.set("");
    expect(session.submit()).toBe(true);
    session.rememberScroll(250);
    session.cancelPending();
    expect(session.text$.peek()).toBe("needle");
    expect(session.scrollOffset).toBe(250);
    expect(session.request$.peek()?.text).toBe("needle");
  });
});
