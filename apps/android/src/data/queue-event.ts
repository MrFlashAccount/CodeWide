import { unknownRecord } from "./unknownRecord";
import type { NativeCommandDelivery } from "../native/native-transport";

export type HostQueuedPrompt = {
  commandId: string;
  createdAt: number;
  lastError: string | null;
  order: number;
  params: Record<string, unknown>;
  presentation: "delivery" | "queue";
  remoteThreadId: string;
  state: "queued" | "uncertain" | "failed" | "delivered";
  updatedAt: number;
  workspaceRequestId: string | null;
};

export function parseHostQueueSnapshot(value: unknown): HostQueuedPrompt[] | null {
  if (!Array.isArray(value)) {
    return null;
  }
  const commands: HostQueuedPrompt[] = [];
  for (const entry of value) {
    const command = asRecord(entry);
    const params = asRecord(command?.params);
    if (
      command === null ||
      params === null ||
      typeof command.commandId !== "string" ||
      typeof command.remoteThreadId !== "string" ||
      typeof command.order !== "number" ||
      !Number.isSafeInteger(command.order) ||
      typeof command.createdAt !== "number" ||
      !Number.isSafeInteger(command.createdAt) ||
      !(
        command.updatedAt === undefined ||
        (typeof command.updatedAt === "number" && Number.isSafeInteger(command.updatedAt))
      ) ||
      (command.presentation !== undefined &&
        command.presentation !== "delivery" &&
        command.presentation !== "queue") ||
      !(
        command.workspaceRequestId === undefined ||
        command.workspaceRequestId === null ||
        typeof command.workspaceRequestId === "string"
      ) ||
      (command.state !== "queued" &&
        command.state !== "uncertain" &&
        command.state !== "failed" &&
        command.state !== "delivered") ||
      (command.lastError !== null && typeof command.lastError !== "string")
    ) {
      return null;
    }
    commands.push({
      commandId: command.commandId,
      createdAt: command.createdAt,
      lastError: command.lastError,
      order: command.order,
      params,
      presentation: command.presentation === "delivery" ? "delivery" : "queue",
      remoteThreadId: command.remoteThreadId,
      state: command.state,
      updatedAt: command.updatedAt ?? command.createdAt,
      workspaceRequestId:
        typeof command.workspaceRequestId === "string" ? command.workspaceRequestId : null,
    });
  }
  return commands;
}

export function hasAppServerAcceptedPendingDelivery(
  commands: readonly HostQueuedPrompt[],
  isPending: (commandId: string) => boolean,
): boolean {
  return commands.some((command) => command.state === "delivered" && isPending(command.commandId));
}

export function hasUnresolvedDeliveredCommand(
  deliveries: readonly NativeCommandDelivery[],
  connectionId: string,
  threadId: string,
  isPending: (commandId: string) => boolean,
): boolean {
  return deliveries.some(
    (delivery) =>
      delivery.connectionId === connectionId &&
      delivery.threadId === threadId &&
      (delivery.method === "turn/start" || delivery.method === "turn/steer") &&
      delivery.state === "delivered" &&
      isPending(delivery.commandId),
  );
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return unknownRecord(value);
}
