import type { SyncEvent } from "@codewide/sync-client";
import { globalSupervisorLimitsV1 } from "./globalSupervisorLimitsV1";
import type { GlobalSupervisorQualifiedChatRef } from "./globalSupervisorBinding";
import type { GlobalSupervisorRuntimeIngress } from "./globalSupervisorRuntimeIngress";
import { unknownRecord } from "./unknownRecord";

export type GlobalSupervisorEventSignalSession = {
  readonly stop: () => Promise<void>;
};

type RealtimeContextSignal = {
  readonly eventKey: string;
  readonly text: string;
};

function completedCompactionThreadId(event: SyncEvent): string | null {
  if (event.payload.method !== "item/completed") {
    return null;
  }
  const params = unknownRecord(event.payload.params);
  const item = unknownRecord(params?.item);
  return item?.type === "contextCompaction" && typeof params?.threadId === "string"
    ? params.threadId
    : null;
}

function realtimeContextSignal(options: {
  readonly connectionId: string;
  readonly event: SyncEvent;
  readonly home: GlobalSupervisorQualifiedChatRef;
  readonly realtimeInstructions: string;
}): RealtimeContextSignal | null {
  const compactedThreadId = completedCompactionThreadId(options.event);
  if (
    options.connectionId === options.home.connectionId &&
    compactedThreadId === options.home.threadId
  ) {
    return {
      eventKey: `${options.connectionId}\u0000${String(options.event.cursor)}`,
      text: options.realtimeInstructions,
    };
  }
  return null;
}

function admitSignal(signal: RealtimeContextSignal, seenEvents: Set<string>): boolean {
  if (seenEvents.has(signal.eventKey)) {
    return false;
  }
  seenEvents.add(signal.eventKey);
  return true;
}

/** Reasserts the activation instructions after home-thread compaction. */
export function createGlobalSupervisorEventSignalSession(options: {
  readonly appendText: (text: string) => Promise<void>;
  readonly home: GlobalSupervisorQualifiedChatRef;
  readonly ingress: GlobalSupervisorRuntimeIngress;
  readonly now: () => number;
  readonly onTerminal: () => void;
  readonly realtimeInstructions: string;
}): GlobalSupervisorEventSignalSession {
  const seenEvents = new Set<string>();
  let windowStartedAt = options.now();
  let accepting = true;
  let tail = Promise.resolve();
  const subscription = options.ingress.subscribeThreadEvents((connectionId, events) => {
    if (!accepting) {
      return;
    }
    const now = options.now();
    if (now - windowStartedAt >= globalSupervisorLimitsV1.eventCoalescingWindowMs) {
      seenEvents.clear();
      windowStartedAt = now;
    }
    for (const event of events) {
      const signal = realtimeContextSignal({
        connectionId,
        event,
        home: options.home,
        realtimeInstructions: options.realtimeInstructions,
      });
      if (signal === null || !admitSignal(signal, seenEvents)) {
        continue;
      }
      tail = tail
        .then(async () => {
          if (accepting) {
            await options.appendText(signal.text);
          }
        })
        .catch(() => {
          options.onTerminal();
        });
    }
  });
  return {
    async stop() {
      accepting = false;
      subscription.unsubscribe();
      await tail;
      seenEvents.clear();
    },
  };
}
