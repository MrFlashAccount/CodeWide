import { MemoryV2OperationStore, type SyncV2Session } from "../src/v2/index.js";
import { FakeV2Socket, snapshot, waitFor } from "./v2-fixtures.js";

export class PausableOperationStore extends MemoryV2OperationStore {
  readonly entered: Promise<void>;
  readonly #pause: "create" | "transition";
  #markEntered!: () => void;
  #release!: () => void;
  readonly #blocked: Promise<void>;

  constructor(pause: "create" | "transition") {
    super();
    this.#pause = pause;
    this.entered = new Promise((resolve) => {
      this.#markEntered = resolve;
    });
    this.#blocked = new Promise((resolve) => {
      this.#release = resolve;
    });
  }

  release(): void {
    this.#release();
  }

  override async create(...parameters: Parameters<MemoryV2OperationStore["create"]>) {
    const operation = await super.create(...parameters);
    if (this.#pause === "create") {
      this.#markEntered();
      await this.#blocked;
    }
    return operation;
  }

  override async transition(...parameters: Parameters<MemoryV2OperationStore["transition"]>) {
    if (this.#pause === "transition") {
      this.#markEntered();
      await this.#blocked;
    }
    return super.transition(...parameters);
  }
}

export async function makeNextEpochLive(
  socket: FakeV2Socket,
  session: SyncV2Session,
): Promise<void> {
  await waitFor(() => socket.sent.filter((frame) => frame.type === "open").length === 2);
  const next = snapshot({ epochId: "epoch-2", revision: "sync-v2-revision:2" });
  socket.emit(next);
  await waitFor(
    () => socket.sent.filter((frame) => frame.type === "snapshotCommitted").length === 2,
  );
  socket.emit({ type: "live", epochId: next.epochId, watermark: next.watermark });
  await waitFor(() => session.state === "live");
}
