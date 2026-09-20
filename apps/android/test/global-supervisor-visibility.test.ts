import { describe, expect, it } from "vitest";

import type { GlobalSupervisorBinding } from "../src/data/globalSupervisorBinding";
import { createGlobalSupervisorSummaryStoragePolicy } from "../src/data/globalSupervisorSummaryStoragePolicy";
import { createGlobalSupervisorVisibilityPolicy } from "../src/data/globalSupervisorVisibility";

describe("GlobalSupervisorVisibilityPolicy", () => {
  it("hides the exact ready ref without hiding similarly named ordinary threads", () => {
    let binding: GlobalSupervisorBinding | null = {
      home: { connectionId: "server-a", threadId: "thread-a" },
      schemaVersion: 1,
      status: "ready",
    };
    const policy = createGlobalSupervisorVisibilityPolicy(() => binding);
    expect(policy.allowsOrdinaryRef("server-a", "thread-a")).toBe(false);
    expect(policy.allowsOrdinaryRef("server-b", "thread-a")).toBe(true);
    expect(
      policy.allowsOrdinaryThread("server-a", {
        id: "ordinary",
        source: "Global Voice Mode",
      }),
    ).toBe(true);
    binding = null;
    expect(policy.allowsOrdinaryRef("server-a", "thread-a")).toBe(true);
  });

  it("hides only the exact creating source token", () => {
    const binding: GlobalSupervisorBinding = {
      creationToken: "token-a",
      homeConnectionId: "server-a",
      schemaVersion: 1,
      status: "creating",
    };
    const policy = createGlobalSupervisorVisibilityPolicy(() => binding);
    expect(
      policy.allowsOrdinaryThread("server-a", {
        id: "thread-a",
        source: "codewide-global-supervisor:token-a",
      }),
    ).toBe(false);
    expect(
      policy.allowsOrdinaryThread("server-a", {
        id: "thread-b",
        source: "codewide-global-supervisor:token-b",
      }),
    ).toBe(true);
    expect(policy.allowsOrdinaryRef("server-a", "ordinary-thread")).toBe(false);
    expect(policy.allowsOrdinaryRef("server-b", "ordinary-thread")).toBe(true);

    const storage = createGlobalSupervisorSummaryStoragePolicy(() => binding);
    expect(
      storage.classifyThread("server-a", {
        id: "thread-a",
        source: "codewide-global-supervisor:token-a",
      }),
    ).toBe("delete");
    expect(storage.classifyRef("server-a", "ordinary-thread")).toBe("preserve");
    expect(storage.mayPruneMissing("server-a")).toBe(false);
  });

  it("fails closed when malformed or ambiguous state has no exact prior home", () => {
    const binding: GlobalSupervisorBinding = {
      priorHome: null,
      reason: "malformedStorage",
      schemaVersion: 1,
      status: "invalid",
    };
    const policy = createGlobalSupervisorVisibilityPolicy(() => binding);

    expect(policy.allowsOrdinaryRef("server-a", "ordinary-thread")).toBe(false);
    expect(policy.allowsOrdinaryThread("server-a", { id: "ordinary-thread", source: null })).toBe(
      false,
    );
    const storage = createGlobalSupervisorSummaryStoragePolicy(() => binding);
    expect(storage.classifyRef("server-a", "ordinary-thread")).toBe("preserve");
    expect(storage.mayPruneMissing("server-a")).toBe(false);
  });

  it("keeps ordinary chats available when invalid state retains an exact prior home", () => {
    const binding: GlobalSupervisorBinding = {
      priorHome: { connectionId: "server-a", threadId: "thread-a" },
      reason: "homeDeleted",
      schemaVersion: 1,
      status: "invalid",
    };
    const policy = createGlobalSupervisorVisibilityPolicy(() => binding);

    expect(policy.allowsOrdinaryRef("server-a", "thread-a")).toBe(false);
    expect(policy.allowsOrdinaryRef("server-a", "ordinary-thread")).toBe(true);
    expect(policy.allowsOrdinaryRef("server-b", "ordinary-thread")).toBe(true);
  });
});
