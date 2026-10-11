/**
 * Reads a thread's history from Claude's session store: the messages of its
 * session chain, rebuilt into neutral turns, with the in-flight turn
 * replaced by the live snapshot (Claude persists messages only when they are
 * complete, so the live builder is the authority while a turn runs).
 */

import type { AgentTurn, AppThreadId } from "../protocol.js";
import type { SessionStore } from "../claude/port.js";
import { reconstructTurns } from "../history/reconstruct.js";
import type { TurnRecord } from "../state/threadState.js";

/** The thread whose history is read. */
export interface HistorySubject {
  readonly appThreadId: AppThreadId;
  readonly cwd: string;
  /** Session chain, oldest first. */
  readonly sessionIds: readonly string[];
  readonly turns: readonly TurnRecord[];
}

/** Places the live snapshot of the active turn into the rebuilt history. */
export function withActiveTurn(
  turns: readonly AgentTurn[],
  active: AgentTurn | null,
  records: readonly TurnRecord[],
): readonly AgentTurn[] {
  if (active === null) {
    return turns;
  }
  const index = turns.findIndex((turn) => turn.turnId === active.turnId);
  if (index !== -1) {
    return turns.with(index, active);
  }
  const last = turns.at(-1);
  const lastIsUnindexedWake =
    last !== undefined &&
    active.origin === "provider" &&
    last.origin === "provider" &&
    !records.some((record) => record.turnId === last.turnId);
  return lastIsUnindexedWake ? [...turns.slice(0, -1), active] : [...turns, active];
}

/** User prompts and final answers, as lines for a replacement session's history prefix. */
export function historyLines(turns: readonly AgentTurn[]): readonly string[] {
  return turns.flatMap((turn) =>
    turn.items.flatMap((item) => {
      if (item.type === "userMessage") {
        const text = item.content
          .flatMap((content) => (content.type === "text" ? [content.text] : []))
          .join("\n");
        return text.length > 0 ? [`User: ${text}`] : [];
      }
      return item.type === "agentMessage" && item.phase === "final" ? [`Claude: ${item.text}`] : [];
    }),
  );
}

export class ThreadHistory {
  private readonly store: SessionStore;

  public constructor(store: SessionStore) {
    this.store = store;
  }

  /** Stored messages of every session in the chain, oldest first. */
  private async messages(subject: HistorySubject): Promise<readonly unknown[]> {
    const pages = await Promise.all(
      subject.sessionIds.map(async (sessionId) =>
        this.store.messages({ cwd: subject.cwd.length > 0 ? subject.cwd : null, sessionId }),
      ),
    );
    return pages.flat();
  }

  /** The thread's completed turns rebuilt from Claude's store. */
  public async turns(subject: HistorySubject): Promise<readonly AgentTurn[]> {
    return reconstructTurns(await this.messages(subject), subject.turns, {
      appThreadId: subject.appThreadId,
      cwd: subject.cwd,
    });
  }
}
