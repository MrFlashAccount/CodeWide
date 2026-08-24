import type { NativeCommandDelivery } from "../native/native-transport";

export type HostQueuedPrompt = {
  commandId: string;
  remoteThreadId: string;
  params: Record<string, unknown>;
  presentation: "delivery" | "queue";
  workspaceRequestId: string | null;
  state: "queued" | "uncertain" | "failed" | "delivered";
  order: number;
  createdAt: number;
  lastError: string | null;
};

export function parseHostQueueSnapshot(value: unknown): HostQueuedPrompt[] | null {
  if (!Array.isArray(value)) return null;
  const commands: HostQueuedPrompt[] = [];
  for (const entry of value) {
    const command = asRecord(entry);
    const params = asRecord(command?.params);
    if (
      command === null
      || params === null
      || typeof command.commandId !== "string"
      || typeof command.remoteThreadId !== "string"
      || !Number.isSafeInteger(command.order)
      || !Number.isSafeInteger(command.createdAt)
      || (command.presentation !== undefined && command.presentation !== "delivery" && command.presentation !== "queue")
      || !(command.workspaceRequestId === undefined || command.workspaceRequestId === null || typeof command.workspaceRequestId === "string")
      || (command.state !== "queued" && command.state !== "uncertain" && command.state !== "failed" && command.state !== "delivered")
      || (command.lastError !== null && typeof command.lastError !== "string")
    ) return null;
    commands.push({
      commandId: command.commandId,
      remoteThreadId: command.remoteThreadId,
      params,
      presentation: command.presentation === "delivery" ? "delivery" : "queue",
      workspaceRequestId: typeof command.workspaceRequestId === "string" ? command.workspaceRequestId : null,
      state: command.state,
      order: command.order as number,
      createdAt: command.createdAt as number,
      lastError: command.lastError as string | null,
    });
  }
  return commands;
}

export function hasAcceptedPendingDelivery(
  commands: readonly HostQueuedPrompt[],
  isPending: (commandId: string) => boolean,
): boolean {
  return commands.some((command) => (
    command.presentation === "delivery"
      && command.state === "delivered"
      && isPending(command.commandId)
  ));
}

export function hasUnresolvedDeliveredCommand(
  deliveries: readonly NativeCommandDelivery[],
  connectionId: string,
  threadId: string,
  isPending: (commandId: string) => boolean,
): boolean {
  return deliveries.some((delivery) => (
    delivery.connectionId === connectionId
    && delivery.threadId === threadId
    && (delivery.method === "turn/start" || delivery.method === "turn/steer")
    && delivery.state === "delivered"
    && isPending(delivery.commandId)
  ));
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null;
}
