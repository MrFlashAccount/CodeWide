import {
  deriveV2AggregateProjection,
  v2SavedServerId,
  type V2AggregateProjection,
  type V2ProjectionStore,
  type V2SavedServerDeletionStore,
  type V2SavedServerId,
} from "@codewide/sync-client/v2";

import type { SavedServerId } from "../../domain/ids";
import { ObservableResource } from "./resource";

const EMPTY_AGGREGATE: V2AggregateProjection = {
  selection: { kind: "all" },
  servers: [],
  threads: [],
};

export class AggregateProjectionResource extends ObservableResource<V2AggregateProjection> {
  readonly #deletions: V2SavedServerDeletionStore;
  readonly #projections: V2ProjectionStore;
  #knownSavedServerIds: readonly V2SavedServerId[] = [];
  #refreshGeneration = 0;
  #unsubscribes: Array<() => void> = [];

  constructor(projections: V2ProjectionStore, deletions: V2SavedServerDeletionStore) {
    super(EMPTY_AGGREGATE);
    this.#projections = projections;
    this.#deletions = deletions;
  }

  async start(savedServerIds: readonly SavedServerId[]): Promise<void> {
    await this.replaceSavedServers(savedServerIds);
  }

  async replaceSavedServers(savedServerIds: readonly SavedServerId[]): Promise<void> {
    this.#unsubscribeAll();
    this.#knownSavedServerIds = savedServerIds.map(v2SavedServerId);
    this.#unsubscribes = this.#knownSavedServerIds.map((savedServerId) =>
      this.#projections.subscribe(savedServerId, this.#projectionChanged),
    );
    await this.refresh();
  }

  async refresh(): Promise<void> {
    const generation = ++this.#refreshGeneration;
    const previous = this.snapshot().value;
    try {
      const value = await deriveV2AggregateProjection(
        { active: this.#readVisibleProjection },
        this.#deletions,
        this.#knownSavedServerIds,
        { kind: "all" },
      );
      if (generation === this.#refreshGeneration) {
        this.publish({ status: "ready", value });
      }
    } catch {
      if (generation === this.#refreshGeneration) {
        this.publish({ message: "Could not load threads", status: "error", value: previous });
      }
    }
  }

  stop(): void {
    ++this.#refreshGeneration;
    this.#unsubscribeAll();
  }

  readonly #projectionChanged = (): void => {
    this.refresh().catch(() => undefined);
  };

  readonly #readVisibleProjection = async (savedServerId: V2SavedServerId) =>
    (await this.#projections.active(savedServerId)) ??
    (await this.#projections.retained(savedServerId));

  #unsubscribeAll(): void {
    for (const unsubscribe of this.#unsubscribes) unsubscribe();
    this.#unsubscribes = [];
  }
}
