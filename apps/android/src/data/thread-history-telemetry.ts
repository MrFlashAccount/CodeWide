import { recordTelemetryEvent, type TelemetryEventInput } from "./telemetry";

type ThreadHistoryTelemetryInput = Omit<TelemetryEventInput, "name" | "connectionId" | "threadId">;

/** Records content-free diagnostics for the chat viewport and its durable history window. */
export function recordThreadHistoryTelemetry(
  connectionId: string,
  threadId: string,
  name: string,
  input: ThreadHistoryTelemetryInput = {},
): void {
  if (connectionId === "" || threadId === "") return;
  recordTelemetryEvent(connectionId, {
    ...input,
    name,
    connectionId,
    threadId,
  });
}

export function telemetryErrorKind(cause: unknown): string {
  if (cause instanceof Error && cause.name.length > 0) return cause.name.slice(0, 128);
  return "unknown";
}
