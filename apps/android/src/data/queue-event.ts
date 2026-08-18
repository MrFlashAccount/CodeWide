export type HostQueuedPrompt = {
  commandId: string;
  remoteThreadId: string;
  params: Record<string, unknown>;
  presentation: "delivery" | "queue";
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
      || (command.state !== "queued" && command.state !== "uncertain" && command.state !== "failed" && command.state !== "delivered")
      || (command.lastError !== null && typeof command.lastError !== "string")
    ) return null;
    commands.push({
      commandId: command.commandId,
      remoteThreadId: command.remoteThreadId,
      params,
      presentation: command.presentation === "delivery" ? "delivery" : "queue",
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

function asRecord(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null;
}
