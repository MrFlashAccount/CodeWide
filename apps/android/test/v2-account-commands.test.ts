import type { V2CommandTerminalFrame } from "@codewide/sync-client/v2";
import { describe, expect, it, vi } from "vitest";

import {
  cancelAccountLogin,
  startAccountLogin,
  updateAccount,
} from "../src/v2/features/settings/accountCommands";
import { savedServerId } from "../src/v2/domain/ids";

describe("V2 account commands", () => {
  it("starts and cancels the typed device-code login", async () => {
    const execute = vi
      .fn()
      .mockResolvedValueOnce(
        completed({
          kind: "account.login.start",
          loginId: "login-1",
          userCode: "ABCD-EFGH",
          verificationUrl: "https://auth.example/device",
        }),
      )
      .mockResolvedValueOnce(
        completed({ kind: "account.login.cancel", loginId: "login-1", state: "cancelled" }),
      );
    const commands = { execute };
    const serverId = savedServerId("server-1");

    await expect(startAccountLogin(commands, serverId)).resolves.toEqual({
      loginId: "login-1",
      userCode: "ABCD-EFGH",
      verificationUrl: "https://auth.example/device",
    });
    await cancelAccountLogin(commands, serverId, "login-1");

    expect(execute).toHaveBeenNthCalledWith(1, serverId, { kind: "account.login.start" });
    expect(execute).toHaveBeenNthCalledWith(2, serverId, {
      kind: "account.login.cancel",
      loginId: "login-1",
    });
  });

  it("surfaces terminal command errors instead of reporting success", async () => {
    const commands = {
      execute: vi.fn(async (): Promise<V2CommandTerminalFrame> =>
        failed("OAuth login is unavailable"),
      ),
    };

    await expect(startAccountLogin(commands, savedServerId("server-1"))).rejects.toThrow(
      "OAuth login is unavailable",
    );
  });

  it("preserves typed activate/configure/remove account operations", async () => {
    const execute = vi.fn(async () =>
      completed({
        activeProfileId: "profile-1",
        affectedProfileId: "profile-1",
        kind: "account.update",
      }),
    );
    const serverId = savedServerId("server-1");

    await updateAccount({ execute }, serverId, { kind: "activate", profileId: "profile-1" });

    expect(execute).toHaveBeenCalledWith(serverId, {
      change: { kind: "activate", profileId: "profile-1" },
      kind: "account.update",
    });
  });
});

function completed(
  result: Extract<V2CommandTerminalFrame, { type: "commandCompleted" }>["result"],
): V2CommandTerminalFrame {
  return { operationId: "operation-1", result, type: "commandCompleted" };
}

function failed(message: string): V2CommandTerminalFrame {
  return {
    error: { code: "sourceUnavailable", message, recovery: "retry" },
    operationId: "operation-1",
    type: "commandFailed",
  };
}
