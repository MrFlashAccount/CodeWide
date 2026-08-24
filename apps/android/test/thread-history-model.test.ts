import { describe, expect, it } from "vitest";

import { createThreadHistoryModel } from "../src/data/thread-history-model";

function row(overrides: Partial<Parameters<ReturnType<typeof createThreadHistoryModel>["put"]>[0]> = {}) {
  return {
    id: "server\u0000thread",
    connectionId: "server",
    threadId: "thread",
    generation: 1,
    historyEpoch: 2,
    status: "ready" as const,
    nextCursor: "older",
    error: null,
    ...overrides,
  };
}

describe("Legend thread history model", () => {
  it("does not invalidate range subscribers for transport-only activity", () => {
    const model = createThreadHistoryModel();
    model.put(row());
    const range = model.cursor$("server\u0000thread").peek();

    model.put(row({ status: "background-updating" }));

    expect(model.cursor$("server\u0000thread").peek()).toBe(range);
    expect(model.activity$("server\u0000thread").peek()).toEqual({
      status: "background-updating",
      error: null,
    });
  });

  it("invalidates cursor subscribers when the remote cursor advances", () => {
    const model = createThreadHistoryModel();
    model.put(row());
    const range = model.cursor$("server\u0000thread").peek();

    model.put(row({ nextCursor: "older-2" }));

    expect(model.cursor$("server\u0000thread").peek()).not.toBe(range);
    expect(model.get("server\u0000thread")?.nextCursor).toBe("older-2");
  });
});
