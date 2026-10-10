/**
 * Settlement of durable native commands whose caller needs the server's answer.
 *
 * `enqueueNativeCommand` resolves once Kotlin has persisted the command; the
 * native outbox then delivers it, retrying across reconnects. Its projection
 * events end in `delivered` (a positive RPC response) or `failed` (an RPC error
 * response, or an invalid persisted command). A caller that awaits the server
 * registers before enqueueing and is settled by those events; while the
 * command stays queued or uncertain (offline, reconnecting) it stays pending.
 * A process restart drops the in-memory waiters, never the queued command.
 */
import type { NativeCommandDelivery } from "../native/native-transport-contract";

/** The server rejected a durable command. Its message is the server's error text. */
export class NativeCommandRejectedError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "NativeCommandRejectedError";
  }
}

type Waiter = {
  readonly reject: (error: NativeCommandRejectedError) => void;
  readonly resolve: () => void;
};

const MAX_REJECTION_MESSAGE_CHARACTERS = 200;

function settlementKey(connectionId: string, commandId: string): string {
  return `${connectionId}\u0000${commandId}`;
}

/** Owns the in-memory waiters of one runtime's native outbox. */
export class NativeCommandSettlements {
  readonly #waiters = new Map<string, Waiter>();

  /**
   * Registers a waiter for a command that is about to be enqueued. The returned
   * promise resolves on delivery and rejects with `NativeCommandRejectedError`
   * when the server rejects the command; `cancel` drops it when the enqueue
   * itself fails.
   */
  register(
    connectionId: string,
    commandId: string,
  ): { readonly cancel: () => void; readonly settled: Promise<void> } {
    const key = settlementKey(connectionId, commandId);
    const settled = new Promise<void>((resolve, reject) => {
      this.#waiters.set(key, { reject, resolve });
    });
    return {
      cancel: () => {
        this.#waiters.delete(key);
      },
      settled,
    };
  }

  /** Settles the waiter of a terminal delivery projection; other states keep it pending. */
  observe(delivery: NativeCommandDelivery): void {
    if (delivery.state !== "delivered" && delivery.state !== "failed") {
      return;
    }
    const key = settlementKey(delivery.connectionId, delivery.commandId);
    const waiter = this.#waiters.get(key);
    if (waiter === undefined) {
      return;
    }
    this.#waiters.delete(key);
    if (delivery.state === "delivered") {
      waiter.resolve();
      return;
    }
    waiter.reject(
      new NativeCommandRejectedError(
        (delivery.lastError ?? "The server rejected the change").slice(
          0,
          MAX_REJECTION_MESSAGE_CHARACTERS,
        ),
      ),
    );
  }
}

/** The process-wide settlement owner fed by the native engine's outbox events. */
export const nativeCommandSettlements = new NativeCommandSettlements();
