import { describe, expect, it, vi } from "vitest";

import {
  globalSupervisorQualifiedChatRef,
  type GlobalSupervisorBindingOwner,
} from "../src/data/globalSupervisorBinding";
import { createGlobalSupervisorSystemRequestDispatcher } from "../src/data/globalSupervisorSystemRequests";

function binding(): GlobalSupervisorBindingOwner {
  return {
    bind: vi.fn(),
    invalidateDeletedConnections: vi.fn(),
    read: vi.fn(async () => ({
      home: globalSupervisorQualifiedChatRef("home-server", "supervisor-thread"),
      schemaVersion: 1 as const,
      status: "ready" as const,
    })),
    reconcile: vi.fn(),
    reset: vi.fn(),
    restoreDeletedHome: vi.fn(async () => null),
  };
}

describe("GlobalSupervisorSystemRequestDispatcher", () => {
  it("routes only dynamic tools from the exact bound home and claims duplicates once", async () => {
    const handle = vi.fn(async () => undefined);
    const fail = vi.fn(async () => undefined);
    const dispatcher = createGlobalSupervisorSystemRequestDispatcher({
      binding: binding(),
      handler: { fail, handle },
      isActive: () => true,
    });
    const requests = [
      {
        id: "tool-request",
        method: "item/tool/call" as const,
        params: {
          arguments: { cursor: null },
          callId: "call",
          namespace: null,
          threadId: "supervisor-thread",
          tool: "listChats",
          turnId: "turn",
        },
      },
    ];

    // Generated request parameter variants are validated by their individual owners;
    // this test exercises the runtime classifier with the protocol-shaped boundary.
    await dispatcher.replace("home-server", requests);
    await dispatcher.replace("home-server", requests);
    expect(handle).toHaveBeenCalledTimes(1);
    expect(handle).toHaveBeenCalledWith({
      connectionId: "home-server",
      params: requests[0]?.params,
      requestId: "tool-request",
      supervisor: globalSupervisorQualifiedChatRef("home-server", "supervisor-thread"),
    });
    expect(fail).not.toHaveBeenCalled();
  });

  it("durably rejects an item/tool/call from another thread", async () => {
    const handle = vi.fn(async () => undefined);
    const fail = vi.fn(async () => undefined);
    const dispatcher = createGlobalSupervisorSystemRequestDispatcher({
      binding: binding(),
      handler: { fail, handle },
      isActive: () => true,
    });
    await dispatcher.replace("home-server", [
      {
        id: "other",
        method: "item/tool/call",
        params: {
          arguments: {},
          callId: "call",
          namespace: null,
          threadId: "ordinary-thread",
          tool: "listChats",
          turnId: "turn",
        },
      },
    ]);
    expect(handle).not.toHaveBeenCalled();
    expect(fail).toHaveBeenCalledWith(
      {
        connectionId: "home-server",
        params: expect.objectContaining({ threadId: "ordinary-thread" }),
        requestId: "other",
        supervisor: globalSupervisorQualifiedChatRef("home-server", "supervisor-thread"),
      },
      "requestNotAdmitted",
    );
  });

  it("leaves ordinary approval requests for the existing user-interaction owner", async () => {
    const handle = vi.fn(async () => undefined);
    const fail = vi.fn(async () => undefined);
    const dispatcher = createGlobalSupervisorSystemRequestDispatcher({
      binding: binding(),
      handler: { fail, handle },
      isActive: () => true,
    });

    await dispatcher.replace("home-server", [
      {
        id: "approval",
        method: "item/commandExecution/requestApproval",
        params: { threadId: "supervisor-thread" },
      },
    ]);

    expect(handle).not.toHaveBeenCalled();
    expect(fail).not.toHaveBeenCalled();
  });

  it("does not read binding state or execute dynamic tools while inactive", async () => {
    const currentBinding = binding();
    const handle = vi.fn(async () => undefined);
    const fail = vi.fn(async () => undefined);
    const dispatcher = createGlobalSupervisorSystemRequestDispatcher({
      binding: currentBinding,
      handler: { fail, handle },
      isActive: () => false,
    });

    await dispatcher.replace("home-server", [
      {
        id: "inactive-tool",
        method: "item/tool/call",
        params: {
          arguments: { cursor: null },
          callId: "call",
          namespace: null,
          threadId: "supervisor-thread",
          tool: "listChats",
          turnId: "turn",
        },
      },
    ]);

    expect(currentBinding.read).not.toHaveBeenCalled();
    expect(handle).not.toHaveBeenCalled();
    expect(fail).not.toHaveBeenCalled();
  });
});
