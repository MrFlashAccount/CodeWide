import type { SyncV2Session, SyncV2SessionSnapshot } from "@codewide/sync-client/v2";

import { ObservableResource } from "./resource";

const EMPTY: SyncV2SessionSnapshot = {
  operations: [],
  projections: { live: null, retained: null },
  state: "offline",
  version: 0,
};

export class ProjectionResource extends ObservableResource<SyncV2SessionSnapshot> {
  readonly #session: SyncV2Session;
  #unsubscribe: (() => void) | null = null;

  constructor(session: SyncV2Session) {
    super(EMPTY);
    this.#session = session;
  }

  start(): void {
    this.#unsubscribe ??= this.#session.subscribe(() => void this.refresh());
    this.#session.start();
    this.refresh().catch(() => undefined);
  }

  async refresh(): Promise<void> {
    try {
      this.publish({ status: "ready", value: await this.#session.snapshot() });
    } catch {
      this.publish({
        message: "Could not read server projection",
        status: "error",
        value: this.snapshot().value,
      });
    }
  }

  stop(): void {
    this.dispose();
    this.#session.stop();
  }

  dispose(): void {
    this.#unsubscribe?.();
    this.#unsubscribe = null;
  }
}
