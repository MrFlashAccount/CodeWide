/**
 * The last answering model of sessions CodeWide never configured, read from
 * Claude's store and kept per session until the session file changes. A
 * thread's projection reads the cache synchronously, so every projection
 * after the first read (including `thread.updated`) reports the same model.
 */

import type { SessionStore, StoredSession } from "../claude/port.js";
import { lastRecordedModel } from "../history/recordedModel.js";

interface Recorded {
  readonly lastModifiedMs: number;
  readonly model: string | null;
}

export class RecordedModels {
  private readonly store: SessionStore;
  private readonly recorded = new Map<string, Recorded>();

  public constructor(store: SessionStore) {
    this.store = store;
  }

  /** The model of the last read; `null` before one or when the session recorded none. */
  public cached(sessionId: string): string | null {
    return this.recorded.get(sessionId)?.model ?? null;
  }

  /** Reads the session's model unless the cached read saw the same file. */
  public async load(session: StoredSession): Promise<string | null> {
    const known = this.recorded.get(session.sessionId);
    if (known?.lastModifiedMs === session.lastModifiedMs) {
      return known.model;
    }
    const messages = await this.store.messages({ cwd: session.cwd, sessionId: session.sessionId });
    const model = lastRecordedModel(messages);
    this.recorded.set(session.sessionId, { lastModifiedMs: session.lastModifiedMs, model });
    return model;
  }
}
