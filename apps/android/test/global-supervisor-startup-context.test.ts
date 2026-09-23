import { describe, expect, it } from "vitest";

import type { GlobalSupervisorAttentionEvent } from "../src/data/globalSupervisorAttention";
import { globalSupervisorQualifiedChatRef } from "../src/data/globalSupervisorBinding";
import { createGlobalSupervisorStartupContextOwner } from "../src/data/globalSupervisorStartupContext";

const HOME = globalSupervisorQualifiedChatRef("home", "supervisor");
const WORKER = globalSupervisorQualifiedChatRef("worker-server", "worker-thread");

function attention(eventId: string): GlobalSupervisorAttentionEvent {
  return {
    eventId,
    kind: "completed",
    observedAt: 1,
    sourceCursor: 1,
    summary: "Worker completed the requested task.",
    supervisor: HOME,
    turnId: "turn-1",
    worker: WORKER,
  };
}

describe("Global Voice startup context", () => {
  it("keeps only bounded conversation text and pending attention events", () => {
    const owner = createGlobalSupervisorStartupContextOwner();
    owner.acceptTranscript("user", "Earlier question");
    owner.acceptTranscript("assistant", "Earlier answer");
    for (let index = 0; index < 9; index += 1) {
      owner.acceptTranscript("user", `recent-${String(index)}`);
    }

    const pending = attention("event-pending");
    const snapshot = owner.snapshot([pending]);

    expect(snapshot.initialItems).toEqual([
      ...Array.from({ length: 8 }, (_, index) => ({
        role: "user" as const,
        text: `recent-${String(index + 1)}`,
      })),
      expect.objectContaining({
        role: "developer",
        text: expect.stringContaining('eventId="event-pending"'),
      }),
    ]);
    expect(snapshot.seededAttentionEventIds).toEqual(new Set(["event-pending"]));
    expect(JSON.stringify(snapshot.initialItems)).not.toContain("Earlier question");
    expect(JSON.stringify(snapshot.initialItems)).not.toContain("Earlier answer");
    expect(JSON.stringify(snapshot.initialItems)).not.toContain("tool");
  });

  it("does not replay acknowledged attention absent from the pending snapshot", () => {
    const owner = createGlobalSupervisorStartupContextOwner();
    owner.acceptTranscript("user", "Continue our conversation");

    const snapshot = owner.snapshot([]);

    expect(snapshot.initialItems).toEqual([{ role: "user", text: "Continue our conversation" }]);
    expect(snapshot.seededAttentionEventIds.size).toBe(0);
  });
});
