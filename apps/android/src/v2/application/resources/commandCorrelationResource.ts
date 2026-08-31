import type { CommandCapabilities } from "../commandCapabilities";
import type {
  CommandCorrelation,
  CommandCorrelationScope,
  CommandSettlement,
} from "../commandCorrelation";
import { ObservableResource } from "./resource";

interface RetainedLock {
  operationId: string;
}

/** Content-free projection of unresolved activations for one feature scope. */
export class CommandCorrelationResource extends ObservableResource<CommandCorrelation[]> {
  static readonly #MAX_SUBSCRIBE_DELAY_MS = 5000;
  readonly #commands: CommandCapabilities;
  readonly #scope: CommandCorrelationScope;
  readonly #retainedLocks = new Map<string, RetainedLock>();
  readonly #settlements = new Map<string, CommandSettlement>();
  #onSettlement: ((settlement: CommandSettlement) => void) | null;
  #authorityGeneration = 0;
  #listenerCount = 0;
  #refreshGeneration = 0;
  #retryTimer: ReturnType<typeof setTimeout> | null = null;
  #subscriptionGeneration = 0;
  #unsubscribe: (() => void) | null = null;

  constructor(
    commands: CommandCapabilities,
    scope: CommandCorrelationScope,
    onSettlement: ((settlement: CommandSettlement) => void) | null = null,
  ) {
    super([]);
    this.#commands = commands;
    this.#scope = scope;
    this.#onSettlement = onSettlement;
  }

  override subscribe = (listener: () => void): (() => void) => {
    const unsubscribeListener = this.addListener(listener);
    this.#listenerCount += 1;
    if (this.#listenerCount === 1) this.#start().catch(() => undefined);
    let subscribed = true;
    return () => {
      if (!subscribed) return;
      subscribed = false;
      unsubscribeListener();
      this.#listenerCount -= 1;
      if (this.#listenerCount === 0) this.#stop();
    };
  };

  async refresh(): Promise<void> {
    const refreshGeneration = ++this.#refreshGeneration;
    try {
      const value = await this.#commands.listLocalUnsettled(this.#scope);
      if (refreshGeneration !== this.#refreshGeneration) return;
      let loadedAuthority = false;
      for (const record of value) {
        const existing = this.#retainedLocks.get(record.correlationId);
        if (existing !== undefined && existing.operationId !== record.operationId) continue;
        if (existing === undefined) loadedAuthority = true;
        this.#retainedLocks.set(record.correlationId, { operationId: record.operationId });
      }
      if (loadedAuthority) this.#authorityGeneration += 1;
      this.publish({ status: "ready", value });
      const authorityGeneration = this.#authorityGeneration;
      const retainedLocks = [...this.#retainedLocks.entries()];
      const reconciled = await Promise.all(
        retainedLocks.map(async ([correlationId, lock]) => ({
          correlationId,
          lock,
          settlement: await this.#commands.reconcile(correlationId).catch(() => null),
        })),
      );
      if (
        refreshGeneration !== this.#refreshGeneration ||
        authorityGeneration !== this.#authorityGeneration
      ) {
        return;
      }
      const settled = new Set<string>();
      const notifications: CommandSettlement[] = [];
      for (const result of reconciled) {
        if (!sameSettlement(result.correlationId, result.lock, result.settlement)) continue;
        if (result.settlement.kind === "durableUnsettled") continue;
        this.#retainedLocks.delete(result.correlationId);
        this.#settlements.set(result.correlationId, result.settlement);
        settled.add(result.correlationId);
        notifications.push(result.settlement);
      }
      if (settled.size > 0) this.#authorityGeneration += 1;
      this.publish({
        status: "ready",
        value: value.filter(({ correlationId }) => !settled.has(correlationId)),
      });
      for (const settlement of notifications) this.#notifySettlement(settlement);
    } catch {
      if (refreshGeneration !== this.#refreshGeneration) return;
      this.publish({
        message: "Could not read saved command status",
        status: "error",
        value: this.snapshot().value,
      });
    }
  }

  attachSettlementObserver(observer: (settlement: CommandSettlement) => void): void {
    if (this.#onSettlement !== null && this.#onSettlement !== observer) {
      throw new Error("Command settlement observer is immutable");
    }
    this.#onSettlement = observer;
  }

  /** Retains exactly one durable operation until typed same-id settlement. */
  retainLock(settlement: Extract<CommandSettlement, { kind: "durableUnsettled" }>): void {
    const existing = this.#retainedLocks.get(settlement.correlationId);
    if (existing !== undefined && existing.operationId !== settlement.operationId) {
      throw new Error("Command correlation identity is immutable");
    }
    this.#retainedLocks.set(settlement.correlationId, { operationId: settlement.operationId });
    this.#settlements.delete(settlement.correlationId);
    this.#authorityGeneration += 1;
    this.#publishCurrent();
    this.refresh().catch(() => undefined);
  }

  isLocked(correlationId: string, operationId?: string): boolean {
    const lock = this.#retainedLocks.get(correlationId);
    return lock !== undefined && (operationId === undefined || lock.operationId === operationId);
  }

  settlement(correlationId: string, operationId: string): CommandSettlement | null {
    const settlement = this.#settlements.get(correlationId);
    return settlement?.operationId === operationId ? settlement : null;
  }

  consumeSettlement(correlationId: string, operationId: string): CommandSettlement | null {
    const settlement = this.settlement(correlationId, operationId);
    if (settlement === null) return null;
    this.#settlements.delete(correlationId);
    return settlement;
  }

  pendingCount(): number {
    return new Set([
      ...this.snapshot().value.map(({ correlationId }) => correlationId),
      ...this.#retainedLocks.keys(),
    ]).size;
  }

  async #start(): Promise<void> {
    const generation = ++this.#subscriptionGeneration;
    // Local SQLite is authoritative for the remount lock. Reading it must not
    // depend on opening the live session used only for future notifications.
    await this.refresh();
    if (generation !== this.#subscriptionGeneration || this.#listenerCount === 0) return;
    await this.#subscribeWithRecovery(generation, 0);
  }

  async #subscribeWithRecovery(generation: number, attempt: number): Promise<void> {
    try {
      const unsubscribe = await this.#commands.subscribe(this.#scope.savedServerId, () => {
        if (generation === this.#subscriptionGeneration) this.refresh().catch(() => undefined);
      });
      if (generation !== this.#subscriptionGeneration || this.#listenerCount === 0) {
        unsubscribe();
        return;
      }
      this.#unsubscribe = unsubscribe;
      // The local projection may have advanced while the live subscription was
      // unavailable. Refresh once before relying on future notifications.
      this.refresh().catch(() => undefined);
    } catch {
      if (generation !== this.#subscriptionGeneration || this.#listenerCount === 0) return;
      this.publish({
        message: "Could not follow saved command status",
        status: "error",
        value: this.snapshot().value,
      });
      const delayMs = Math.min(
        100 * 2 ** Math.min(attempt, 6),
        CommandCorrelationResource.#MAX_SUBSCRIBE_DELAY_MS,
      );
      this.#retryTimer = setTimeout(() => {
        this.#retryTimer = null;
        this.#subscribeWithRecovery(generation, attempt + 1).catch(() => undefined);
      }, delayMs);
    }
  }

  #stop(): void {
    this.#refreshGeneration += 1;
    this.#subscriptionGeneration += 1;
    if (this.#retryTimer !== null) clearTimeout(this.#retryTimer);
    this.#retryTimer = null;
    this.#unsubscribe?.();
    this.#unsubscribe = null;
  }

  #publishCurrent(): void {
    const snapshot = this.snapshot();
    this.publish({ ...snapshot });
  }

  #notifySettlement(settlement: CommandSettlement): void {
    if (this.#onSettlement === null) return;
    try {
      this.#onSettlement(settlement);
    } catch {
      // UI observation cannot change the authoritative resource settlement.
    } finally {
      this.#settlements.delete(settlement.correlationId);
    }
  }
}

function sameSettlement(
  correlationId: string,
  lock: RetainedLock,
  settlement: CommandSettlement | null,
): settlement is CommandSettlement {
  return (
    settlement !== null &&
    settlement.correlationId === correlationId &&
    settlement.operationId === lock.operationId
  );
}
