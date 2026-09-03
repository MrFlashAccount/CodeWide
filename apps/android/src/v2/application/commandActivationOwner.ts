import type { V2Command, V2CommandTerminalFrame } from "@codewide/sync-client/v2";

import type { SavedServerId } from "../domain/ids";
import type { CommandCapabilities } from "./commandCapabilities";
import type { CommandCorrelationScope, CommandSettlement } from "./commandCorrelation";

/** @testOnly Exposes typed terminal-settlement mapping to black-box command regressions. */
export class CommandActivationError extends Error {
  readonly correlationId: string;
  readonly operationId: string;
  readonly retryable: boolean;

  constructor(settlement: Exclude<CommandSettlement, { kind: "terminal" }>) {
    super(settlement.failure.message);
    this.name = "CommandActivationError";
    this.correlationId = settlement.correlationId;
    this.operationId = settlement.operationId;
    this.retryable = settlement.failure.retryable;
  }
}

/** @testOnly Exposes recovered-settlement mapping to black-box command regressions. */
export class CommandActivationRecoveredError extends Error {
  readonly correlationId: string;
  readonly operationId: string;
  readonly retryable = true;

  constructor(settlement: Extract<CommandSettlement, { kind: "terminal" }>) {
    super("The previous action settled. Activate this action again if it is still needed.");
    this.name = "CommandActivationRecoveredError";
    this.correlationId = settlement.correlationId;
    this.operationId = settlement.operationId;
  }
}

/**
 * Owns the content-free one-activation/one-operation boundary for every V2 command action.
 * A second activation in the same semantic scope recovers the older operation instead of
 * allocating another id. Command payloads are deliberately never retained or fingerprinted.
 */
export class CommandActivationOwner {
  readonly #commands: CommandCapabilities;

  constructor(commands: CommandCapabilities) {
    this.#commands = commands;
  }

  async execute(savedServerId: SavedServerId, command: V2Command): Promise<V2CommandTerminalFrame> {
    const settlement = await this.#commands.executeCorrelated(
      commandActivationScope(savedServerId, command),
      command,
    );
    if (settlement.kind === "terminal" && settlement.recovered !== true) return settlement.frame;
    if (settlement.kind === "terminal") throw new CommandActivationRecoveredError(settlement);
    throw new CommandActivationError(settlement);
  }

  async release(savedServerId: SavedServerId, command: V2Command): Promise<void> {
    await this.#commands.releaseScope(commandActivationScope(savedServerId, command));
  }

  scope(savedServerId: SavedServerId, command: V2Command): CommandCorrelationScope {
    return commandActivationScope(savedServerId, command);
  }
}

/** @testOnly Exposes the semantic deduplication key for black-box command regressions. */
export function commandActivationScope(
  savedServerId: SavedServerId,
  command: V2Command,
): CommandCorrelationScope {
  return {
    savedServerId,
    surface: "commandAction",
    threadId: commandActivationKey(command),
  };
}

function commandActivationKey(command: V2Command): string {
  switch (command.kind) {
    case "thread.create":
    case "project.add":
    case "workspace.create":
    case "account.login.start":
      return command.kind;
    case "thread.fork":
    case "thread.delete":
    case "thread.compact":
    case "thread.markRead":
    case "thread.rollback":
    case "review.start":
      return activationKey(command.kind, command.threadId);
    case "thread.update":
      return activationKey(command.kind, command.change.kind, command.threadId);
    case "turn.submit":
      return activationKey(command.kind, command.threadId ?? "new");
    case "turn.steer":
    case "turn.interrupt":
      return activationKey(command.kind, command.threadId, command.turnId);
    case "queue.mutate":
      return queueActivationKey(command.mutation);
    case "account.update":
      return activationKey(command.kind, command.change.kind, command.change.profileId);
    case "account.login.cancel":
      return activationKey(command.kind, command.loginId);
    case "process.terminate":
      return activationKey(command.kind, command.threadId, command.processId);
    case "request.resolve":
      return activationKey(command.kind, command.requestId, command.generation);
    default:
      return assertNever(command);
  }
}

function queueActivationKey(
  command: Extract<V2Command, { kind: "queue.mutate" }>["mutation"],
): string {
  if (command.kind === "put") return activationKey("queue.mutate", command.kind, command.threadId);
  return activationKey("queue.mutate", command.kind, command.itemId);
}

function activationKey(...parts: string[]): string {
  return parts.map((part) => `${part.length}:${part}`).join("|");
}

function assertNever(value: never): never {
  throw new Error(`Unsupported command activation: ${String(value)}`);
}
