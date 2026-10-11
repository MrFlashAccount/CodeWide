/**
 * Claude's session listing as the thread service reads it, plus the last
 * metadata (title, first prompt, timestamps) seen per session so live
 * `thread.updated` projections need no I/O. Every listing rescans Claude's
 * store: the host keeps no index or cache of history; the companion's native
 * index (fed by `nativeSession.list` / `nativeSession.read`) owns that.
 */

import type { SessionLocation, SessionStore, StoredSession } from "../claude/port.js";

export interface CatalogSnapshot {
  /** Sessions a person started interactively (as Claude's `/resume` lists them). */
  readonly interactive: ReadonlySet<string>;
  /** Every session in the store, including SDK-started ones, by id. */
  readonly sessions: ReadonlyMap<string, StoredSession>;
}

export interface CatalogPage {
  /** Ids of the interactive sessions among `sessions`. */
  readonly interactive: ReadonlySet<string>;
  /** Whether the store has sessions after this page. */
  readonly more: boolean;
  readonly sessions: readonly StoredSession[];
}

export class SessionCatalog {
  private readonly known = new Map<string, StoredSession>();
  private readonly store: SessionStore;

  public constructor(store: SessionStore) {
    this.store = store;
  }

  private remember(sessions: readonly StoredSession[]): void {
    for (const session of sessions) {
      this.known.set(session.sessionId, session);
    }
  }

  /** Every session of every project. */
  public async snapshot(): Promise<CatalogSnapshot> {
    const [all, interactive] = await Promise.all([
      this.store.list({ dir: null, limit: null, offset: 0, scope: "all" }),
      this.store.list({ dir: null, limit: null, offset: 0, scope: "interactive" }),
    ]);
    this.remember(all);
    return {
      interactive: new Set(interactive.map((session) => session.sessionId)),
      sessions: new Map(all.map((session) => [session.sessionId, session])),
    };
  }

  /** One page of every session (newest first), optionally of one project directory. */
  public async page(query: {
    readonly dir: string | null;
    readonly limit: number;
    readonly offset: number;
  }): Promise<CatalogPage> {
    const [sessions, interactive] = await Promise.all([
      this.store.list({ ...query, limit: query.limit + 1, scope: "all" }),
      this.store.list({ dir: query.dir, limit: null, offset: 0, scope: "interactive" }),
    ]);
    const page = sessions.slice(0, query.limit);
    this.remember(page);
    return {
      interactive: new Set(interactive.map((session) => session.sessionId)),
      more: sessions.length > query.limit,
      sessions: page,
    };
  }

  /** The last known metadata of a session, without I/O. */
  public cached(sessionId: string): StoredSession | null {
    return this.known.get(sessionId) ?? null;
  }

  /** Reads one session's metadata from the store and remembers it. */
  public async refresh(location: SessionLocation): Promise<StoredSession | null> {
    const session = await this.store.info(location);
    if (session === null) {
      this.known.delete(location.sessionId);
    } else {
      this.known.set(session.sessionId, session);
    }
    return session;
  }

  /** Records a title the host just set, so projections show it at once. */
  public rememberTitle(sessionId: string, title: string): void {
    const session = this.known.get(sessionId);
    if (session !== undefined) {
      this.known.set(sessionId, { ...session, title });
    }
  }

  /** Forgets a deleted session. */
  public forget(sessionId: string): void {
    this.known.delete(sessionId);
  }
}
