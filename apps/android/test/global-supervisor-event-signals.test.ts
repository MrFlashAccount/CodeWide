import { describe, expect, it, vi } from "vitest";

import { globalSupervisorQualifiedChatRef } from "../src/data/globalSupervisorBinding";
import { createGlobalSupervisorEventSignalSession } from "../src/data/globalSupervisorEventSignals";
import { createGlobalSupervisorRuntimeIngress } from "../src/data/globalSupervisorRuntimeIngress";

function completed(cursor: number, threadId: string) {
  return {
    cursor,
    payload: { method: "turn/completed", params: { threadId } },
  };
}

function compacted(cursor: number, threadId: string) {
  return {
    cursor,
    payload: {
      method: "item/completed",
      params: {
        completedAtMs: 1,
        item: { id: `compaction-${String(cursor)}`, type: "contextCompaction" },
        threadId,
        turnId: `turn-${String(cursor)}`,
      },
    },
  };
}

describe("Global Supervisor event signals", () => {
  it("does not turn unrelated chat completion into transient realtime context", async () => {
    const ingress = createGlobalSupervisorRuntimeIngress();
    const appendText = vi.fn(async (_text: string) => undefined);

    ingress.publishThreadEvents("server-a", [completed(1, "before-start")]);
    const session = createGlobalSupervisorEventSignalSession({
      appendText,
      home: globalSupervisorQualifiedChatRef("home", "supervisor"),
      ingress,
      now: () => 1,
      onTerminal: vi.fn(),
      realtimeInstructions: "Voice Assistant instructions",
    });
    ingress.publishThreadEvents("server-a", [completed(2, "active-thread")]);

    await Promise.resolve();
    expect(appendText).not.toHaveBeenCalled();

    await session.stop();
    ingress.publishThreadEvents("server-a", [completed(3, "after-stop")]);
    expect(appendText).not.toHaveBeenCalled();
  });

  it("reasserts the activation instructions after the home thread is compacted", async () => {
    const ingress = createGlobalSupervisorRuntimeIngress();
    const observed = Promise.withResolvers<string>();
    const appendText = vi.fn(async (text: string) => {
      observed.resolve(text);
    });
    const session = createGlobalSupervisorEventSignalSession({
      appendText,
      home: globalSupervisorQualifiedChatRef("home", "supervisor"),
      ingress,
      now: () => 1,
      onTerminal: vi.fn(),
      realtimeInstructions: "Always answer in Russian",
    });

    ingress.publishThreadEvents("home", [compacted(1, "another-thread")]);
    expect(appendText).not.toHaveBeenCalled();
    ingress.publishThreadEvents("home", [compacted(2, "supervisor")]);

    await expect(observed.promise).resolves.toBe("Always answer in Russian");
    expect(appendText).toHaveBeenCalledOnce();
    await session.stop();
  });
});
