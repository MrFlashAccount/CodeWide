import {
  commandOutputField,
  commandOutputReferences,
  type CommandOutputReference,
} from "@codewide/sync-client";
import { unknownRecord } from "./unknownRecord";

/** A command snapshot, validated independently of the provider's history DTO. */
export type TerminalCommandSnapshot = {
  readonly command: string;
  readonly exitCode: number | null;
  readonly output: string;
  readonly references: readonly CommandOutputReference[];
  readonly status: "completed" | "failed" | "declined";
};

/** Only output events for a selected command cross this boundary. */
export type TerminalOutputEvent =
  | {
      readonly kind: "delta";
      readonly reference: CommandOutputReference | null;
      readonly text: string;
    }
  | { readonly kind: "completed"; readonly snapshot: TerminalCommandSnapshot };

type Listener = {
  readonly connectionId: string;
  readonly emit: (event: TerminalOutputEvent) => void;
  readonly itemId: string;
  readonly threadId: string;
};
const listeners = new Set<Listener>();

/** Validates a completed command before it enters an output viewer. */
export function parseTerminalCommand(value: unknown): TerminalCommandSnapshot | null {
  const item = unknownRecord(value);
  if (item === null) {
    return null;
  }
  if (
    item.type !== "commandExecution" ||
    typeof item.command !== "string" ||
    !isCompletedStatus(item.status)
  ) {
    return null;
  }
  return {
    command: item.command,
    exitCode: typeof item.exitCode === "number" ? item.exitCode : null,
    output: typeof item.aggregatedOutput === "string" ? item.aggregatedOutput : "",
    references: commandOutputReferences(item),
    status: item.status,
  };
}

function isCompletedStatus(value: unknown): value is TerminalCommandSnapshot["status"] {
  return value === "completed" || value === "failed" || value === "declined";
}

type QualifiedEvent = {
  readonly event: TerminalOutputEvent;
  readonly itemId: string;
  readonly threadId: string;
};

function parseEvent(method: unknown, params: unknown): QualifiedEvent | null {
  const raw = unknownRecord(params);
  if (raw === null || typeof raw.threadId !== "string") {
    return null;
  }
  if (method === "item/commandExecution/outputDelta" && typeof raw.itemId === "string") {
    return { event: parseDelta(raw), itemId: raw.itemId, threadId: raw.threadId };
  }
  if (method !== "item/completed" && method !== "item/updated") {
    return null;
  }
  return parseCompletion(raw);
}

function parseDelta(raw: Record<string, unknown>): TerminalOutputEvent {
  return {
    kind: "delta",
    reference: commandOutputField(raw, "/delta"),
    text: typeof raw.delta === "string" ? raw.delta : "",
  };
}

function parseCompletion(raw: Record<string, unknown>): QualifiedEvent | null {
  const item = unknownRecord(raw.item);
  const snapshot = parseTerminalCommand(item);
  if (snapshot === null || typeof item?.id !== "string" || typeof raw.threadId !== "string") {
    return null;
  }
  return { event: { kind: "completed", snapshot }, itemId: item.id, threadId: raw.threadId };
}

/** No cache: a visible output viewer owns its subscription and received text. */
export const terminalOutputEvents = {
  publish(connectionId: string, method: unknown, params: unknown): void {
    if (listeners.size === 0) {
      return;
    }
    const parsed = parseEvent(method, params);
    if (parsed === null) {
      return;
    }
    for (const listener of listeners) {
      if (
        listener.connectionId === connectionId &&
        listener.threadId === parsed.threadId &&
        listener.itemId === parsed.itemId
      ) {
        listener.emit(parsed.event);
      }
    }
  },
  subscribe(listener: Listener): () => void {
    listeners.add(listener);
    return () => {
      listeners.delete(listener);
    };
  },
};
