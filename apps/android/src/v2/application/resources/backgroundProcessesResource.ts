import type {
  V2BackgroundProcess,
  V2Command,
  V2CommandTerminalFrame,
  V2Query,
  V2QueryResult,
} from "@codewide/sync-client/v2";

import type { SavedServerId } from "../../domain/ids";
import type { QualifiedThread } from "../../domain/qualifiedThread";
import { ObservableResource } from "./resource";

const PROCESS_LIMIT = 100;
const PROCESS_POLL_MS = 3000;

interface BackgroundProcessesResourceInput {
  commands: BackgroundProcessCommands;
  owner: QualifiedThread;
  queries: BackgroundProcessQueries;
}

interface BackgroundProcessCommands {
  execute(savedServerId: SavedServerId, command: V2Command): Promise<V2CommandTerminalFrame>;
}

interface BackgroundProcessQueries {
  execute(savedServerId: SavedServerId, query: V2Query): Promise<V2QueryResult>;
}

export class BackgroundProcessesResource extends ObservableResource<
  readonly V2BackgroundProcess[]
> {
  readonly #commands: BackgroundProcessCommands;
  readonly #owner: QualifiedThread;
  readonly #queries: BackgroundProcessQueries;
  #pollTimer: ReturnType<typeof setInterval> | null = null;
  #refreshing: Promise<void> | null = null;
  #stopped = false;
  #subscribers = 0;

  constructor(input: BackgroundProcessesResourceInput) {
    super([]);
    this.#commands = input.commands;
    this.#owner = input.owner;
    this.#queries = input.queries;
    void this.refresh().catch(() => undefined);
  }

  override subscribe = (listener: () => void): (() => void) => {
    this.#subscribers += 1;
    if (this.#pollTimer === null && !this.#stopped) {
      this.#pollTimer = setInterval(
        () => void this.refresh().catch(() => undefined),
        PROCESS_POLL_MS,
      );
    }
    const remove = this.addListener(listener);
    return () => {
      remove();
      this.#subscribers -= 1;
      if (this.#subscribers === 0) this.#clearPollTimer();
    };
  };

  refresh(): Promise<void> {
    if (this.#stopped) return Promise.resolve();
    if (this.#refreshing !== null) return this.#refreshing;
    const refreshing = this.#refresh().finally(() => {
      if (this.#refreshing === refreshing) this.#refreshing = null;
    });
    this.#refreshing = refreshing;
    return refreshing;
  }

  async terminate(processId: string): Promise<void> {
    const frame = await this.#commands.execute(this.#owner.savedServerId, {
      kind: "process.terminate",
      processId,
      threadId: this.#owner.threadId,
    });
    if (frame.type !== "commandCompleted") throw new Error(frame.error.message);
    if (frame.result.kind !== "process.terminate" || frame.result.processId !== processId) {
      throw new Error("The server returned the wrong process termination result");
    }
    await this.refresh();
  }

  stop(): void {
    if (this.#stopped) return;
    this.#stopped = true;
    this.#clearPollTimer();
  }

  async #refresh(): Promise<void> {
    try {
      const processes: V2BackgroundProcess[] = [];
      const cursors = new Set<string>();
      let cursor: string | null = null;
      do {
        const result = await this.#queries.execute(this.#owner.savedServerId, {
          cursor,
          kind: "thread.processes",
          limit: PROCESS_LIMIT,
          threadId: this.#owner.threadId,
        });
        if (result.kind !== "thread.processes" || result.threadId !== this.#owner.threadId) {
          throw new Error("The server returned the wrong background process list");
        }
        processes.push(...result.processes);
        cursor = result.nextCursor;
        if (cursor !== null && cursors.has(cursor)) {
          throw new Error("The server repeated a background process cursor");
        }
        if (cursor !== null) cursors.add(cursor);
      } while (cursor !== null && !this.#stopped);
      if (this.#stopped) return;
      this.publish({ status: "ready", value: processes });
    } catch (cause) {
      if (this.#stopped) return;
      this.publish({
        message: processErrorMessage(cause, "Could not read background processes"),
        status: "error",
        value: this.snapshot().value,
      });
    }
  }

  #clearPollTimer(): void {
    if (this.#pollTimer === null) return;
    clearInterval(this.#pollTimer);
    this.#pollTimer = null;
  }
}

function processErrorMessage(cause: unknown, fallback: string): string {
  return cause instanceof Error && cause.message.trim() !== "" ? cause.message : fallback;
}

export function backgroundProcessesKey(savedServerId: SavedServerId, threadId: string): string {
  return `${savedServerId}\u0000${threadId}`;
}
