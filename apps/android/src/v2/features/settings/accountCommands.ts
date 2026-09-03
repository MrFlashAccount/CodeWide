import type { V2Command, V2CommandResult, V2CommandTerminalFrame } from "@codewide/sync-client/v2";

import type { SavedServerId } from "../../domain/ids";
import type { AccountLoginStart } from "./useAccountLogin";

interface AccountCommandExecutor {
  execute(savedServerId: SavedServerId, command: V2Command): Promise<V2CommandTerminalFrame>;
}

export async function startAccountLogin(
  commands: AccountCommandExecutor,
  savedServerId: SavedServerId,
): Promise<AccountLoginStart> {
  const result = await executeAccountCommand(commands, savedServerId, {
    kind: "account.login.start",
  });
  if (result.kind !== "account.login.start") throw new Error("Unexpected account login result");
  return {
    loginId: result.loginId,
    userCode: result.userCode,
    verificationUrl: result.verificationUrl,
  };
}

export async function cancelAccountLogin(
  commands: AccountCommandExecutor,
  savedServerId: SavedServerId,
  loginId: string,
): Promise<void> {
  const result = await executeAccountCommand(commands, savedServerId, {
    kind: "account.login.cancel",
    loginId,
  });
  if (result.kind !== "account.login.cancel") throw new Error("Unexpected account login result");
}

export async function updateAccount(
  commands: AccountCommandExecutor,
  savedServerId: SavedServerId,
  change: Extract<V2Command, { kind: "account.update" }>["change"],
): Promise<void> {
  const result = await executeAccountCommand(commands, savedServerId, {
    change,
    kind: "account.update",
  });
  if (result.kind !== "account.update") throw new Error("Unexpected account update result");
}

async function executeAccountCommand(
  commands: AccountCommandExecutor,
  savedServerId: SavedServerId,
  command: V2Command,
): Promise<V2CommandResult> {
  const frame = await commands.execute(savedServerId, command);
  if (frame.type === "commandCompleted") return frame.result;
  throw new Error(frame.error.message);
}
