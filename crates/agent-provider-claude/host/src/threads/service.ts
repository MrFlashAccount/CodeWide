/**
 * The operations of the `codewide-agent` v1 protocol over Claude's session
 * store, the host's own thread metadata and the live sessions.
 *
 * Threads come from two sources: threads CodeWide created (host-minted ids)
 * and sessions Claude already has, for example started with `claude` in a
 * terminal (their session id is the thread id). Listing, reading and history
 * come from Claude's store; the host adds only its own metadata.
 *
 * Repeat semantics: `thread.create` with the same id returns the existing
 * thread; name/archive/unarchive/settings repeats answer with the current
 * thread and emit `thread.updated` only on a real change; delete is
 * idempotent through a tombstone and never waits on anything but Claude's
 * own file removal; `turn.interrupt` answers in every state. Errors use the
 * protocol's codes and texts.
 */

import type {
  AgentEvent,
  AgentThread,
  AgentTurn,
  ClientMessageId,
  ClientToolSpec,
  ItemsView,
  NativeSession,
  NativeRequestId,
  RuntimeResponse,
  SortDirection,
  ThreadChange,
  ThreadListParams,
  ThreadSettings,
  TurnId,
  TurnStartResult,
  UserContent,
} from "../protocol.js";
import {
  asAppThreadId,
  ERROR_CODES,
  nativeSessionNotFoundMessage,
  threadNotFoundMessage,
} from "../protocol.js";
import type { RunningSessions, SessionStore, StoredSession } from "../claude/port.js";
import { isProfileId, unsupportedProfileMessage } from "../permissions/profiles.js";
import {
  currentSessionId,
  isArchived,
  isDeleted,
  NEW_THREAD_USAGE,
  THREAD_STATE_VERSION,
  ZERO_USAGE,
  type ThreadState,
  type TitleOverride,
} from "../state/threadState.js";
import { historyLines, ThreadHistory, withActiveTurn } from "./history.js";
import { contentText } from "./prompt.js";
import {
  NativeSessionReader,
  type NativeListQuery,
  type NativeRead,
  type SessionOwner,
} from "./nativeSessions.js";
import { unreachable } from "../support/unreachable.js";
import { listThreads, type ListRow } from "./listing.js";
import {
  codewideMetadata,
  discoveredSettings,
  isShell,
  projectThread,
  searchText,
  type ThreadView,
} from "./projection.js";
import type { ModelCatalog } from "../catalog/models.js";
import { OpenElsewhere } from "./openElsewhere.js";
import { RecordedModels } from "./recordedModels.js";
import { ThreadRegistry, type RegistryDeps, type ThreadEntry } from "./registry.js";
import type { SessionCatalog } from "./sessionCatalog.js";

export type OperationResult<Value> =
  | { readonly code: number; readonly message: string; readonly status: "error" }
  | { readonly status: "ok"; readonly value: Value };

const ok = <Value>(value: Value): OperationResult<Value> => ({ status: "ok", value });
const fail = <Value>(code: number, message: string): OperationResult<Value> => ({
  code,
  message,
  status: "error",
});
const notFound = <Value>(appThreadId: string): OperationResult<Value> =>
  fail(ERROR_CODES.invalidRequest, threadNotFoundMessage(appThreadId));

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/iu;
const MS_PER_SECOND = 1000;
const MAX_TURNS_PAGE = 200;
const seconds = (ms: number): number => Math.floor(ms / MS_PER_SECOND);

export interface ServiceDeps extends RegistryDeps {
  readonly catalog: SessionCatalog;
  /** Maps a recorded model id to the catalog's id for it. */
  readonly models: Pick<ModelCatalog, "idFor">;
  /** How often the running sessions are re-read while one is held elsewhere. */
  readonly openElsewherePollMs: number;
  readonly runningSessions: RunningSessions;
  readonly sessionStore: SessionStore;
}

/** Matched by clients as the "conversation open elsewhere" failure. */
export const OPEN_ELSEWHERE_MESSAGE =
  "This conversation is open in another app: another Claude process is running this session. " +
  "Close it there, then try again here.";

/** A thread id resolved against the host's metadata and Claude's store. */
type Resolved =
  | { readonly entry: ThreadEntry; readonly type: "deleted" }
  | { readonly entry: ThreadEntry; readonly type: "entry" }
  | { readonly session: StoredSession; readonly type: "discovered" }
  | { readonly type: "missing" };

type ListedThread = Extract<Resolved, { readonly type: "discovered" | "entry" }>;

const isListed = (resolved: Resolved): resolved is ListedThread =>
  resolved.type === "entry" || resolved.type === "discovered";

/** An empty or blank name clears the name. */
const normalizedName = (name: string | null): string | null =>
  name === null || name.trim().length === 0 ? null : name;

/** One page of turns strictly after the cursor turn. */
function pageTurns(
  all: readonly AgentTurn[],
  query: TurnsQuery,
): OperationResult<{ readonly nextCursor: string | null; readonly turns: readonly AgentTurn[] }> {
  const ordered = query.sortDirection === "asc" ? all : all.toReversed();
  const start =
    query.cursor === null ? 0 : ordered.findIndex((turn) => turn.turnId === query.cursor) + 1;
  if (query.cursor !== null && start === 0) {
    return fail(ERROR_CODES.invalidParams, "invalid turns cursor");
  }
  const size = Math.max(1, Math.min(query.limit, MAX_TURNS_PAGE));
  const page = ordered.slice(start, start + size).map((turn) => viewItems(turn, query.itemsView));
  const last = page.at(-1);
  return ok({
    nextCursor: last !== undefined && start + size < ordered.length ? last.turnId : null,
    turns: page,
  });
}

const listRow = (view: ThreadView): ListRow => ({
  searchText: searchText(view),
  shell: isShell(view),
  thread: projectThread(view),
});

export interface TurnsQuery {
  readonly appThreadId: string;
  readonly cursor: string | null;
  readonly itemsView: ItemsView;
  readonly limit: number;
  readonly sortDirection: SortDirection;
}

export interface UserMessage {
  readonly clientMessageId: ClientMessageId | null;
  readonly input: readonly UserContent[];
}

function viewItems(turn: AgentTurn, view: ItemsView): AgentTurn {
  switch (view) {
    case "full":
      return turn;
    case "notLoaded":
      return { ...turn, items: [] };
    case "summary":
      return {
        ...turn,
        items: turn.items.filter(
          (item) =>
            item.type === "userMessage" || (item.type === "agentMessage" && item.phase === "final"),
        ),
      };
    default:
      return unreachable(view);
  }
}

/** Text of the active turn's first user message. */
function livePrompt(turn: AgentTurn | null): string | null {
  const first = turn?.items[0];
  if (first?.type !== "userMessage") {
    return null;
  }
  const text = contentText(first.content);
  return text.length > 0 ? text : null;
}

/** Title override after the user cleared the name while Claude shows `title`. */
const clearedTitle = (title: string | null): TitleOverride =>
  title === null ? { type: "none" } : { hiddenTitle: title, type: "cleared" };

export class ThreadService {
  private readonly registry: ThreadRegistry;
  private readonly history: ThreadHistory;
  private readonly native: NativeSessionReader;
  private readonly openElsewhere: OpenElsewhere;
  private readonly recordedModels: RecordedModels;
  private readonly deps: ServiceDeps;

  public constructor(deps: ServiceDeps) {
    this.deps = deps;
    this.history = new ThreadHistory(deps.sessionStore);
    this.native = new NativeSessionReader({
      catalog: deps.catalog,
      ownerOf: (sessionId) => this.sessionOwner(sessionId),
      store: deps.sessionStore,
    });
    this.recordedModels = new RecordedModels(deps.sessionStore);
    this.openElsewhere = new OpenElsewhere({
      changed: (sessionIds) => {
        this.onOpenElsewhereChanged(sessionIds);
      },
      logger: deps.logger,
      ownsLive: (sessionId) => this.ownsLive(sessionId),
      pollMs: deps.openElsewherePollMs,
      running: deps.runningSessions,
    });
    this.registry = new ThreadRegistry(deps, {
      historyLines: async (entry) =>
        historyLines(await this.history.turns(this.subjectOf(entry.state))),
      project: (entry) => this.project(entry),
      sessionReady: (entry) => {
        this.onSessionReady(entry);
      },
    });
  }

  /** Loads the host's metadata and finalizes turns a previous process left in progress. */
  public load(): readonly AgentEvent[] {
    const events = this.registry.load();
    for (const entry of this.registry.all()) {
      if (entry.state.title.type === "pending" && entry.state.sessionStarted) {
        this.onSessionReady(entry);
      }
    }
    return events;
  }

  public get liveSessionCount(): number {
    return this.registry.liveSessionCount;
  }

  /** Ends every live session (host shutdown). */
  public shutdown(): void {
    this.openElsewhere.shutdown();
    this.registry.shutdown();
  }

  /** Whether a live query of this host runs `sessionId`. */
  private ownsLive(sessionId: string): boolean {
    const entry = this.registry.ownerOf(sessionId);
    return entry !== null && entry.session.isLive && currentSessionId(entry.state) === sessionId;
  }

  /** Publishes the threads whose current session another process took or released. */
  private onOpenElsewhereChanged(sessionIds: ReadonlySet<string>): void {
    for (const sessionId of sessionIds) {
      const entry = this.registry.ownerOf(sessionId);
      if (entry !== null) {
        if (!isDeleted(entry.state) && currentSessionId(entry.state) === sessionId) {
          this.emitUpdated(this.project(entry));
        }
        continue;
      }
      // Only a session Claude's listing showed is a thread clients may know.
      const session = this.deps.catalog.cached(sessionId);
      if (session !== null && UUID.test(sessionId)) {
        this.emitUpdated(projectThread(this.discoveredView(session)));
      }
    }
  }

  /** The host thread a native session belongs to, with the live turn running in it. */
  private sessionOwner(sessionId: string): SessionOwner | null {
    const entry = this.registry.ownerOf(sessionId);
    if (entry === null) {
      return null;
    }
    const current = currentSessionId(entry.state) === sessionId;
    return {
      activeTurn: current ? entry.session.activeSnapshot() : null,
      appThreadId: entry.state.appThreadId,
      codewide: codewideMetadata(entry.state),
      cwd: entry.state.cwd,
      turns: entry.state.turns,
    };
  }

  /** `nativeSession.list`: one page of Claude's sessions for the companion's native index. */
  public async nativeSessions(query: NativeListQuery): Promise<
    OperationResult<{
      readonly nextCursor: string | null;
      readonly sessions: readonly NativeSession[];
    }>
  > {
    const result = await this.native.list(query);
    return result.status === "ok"
      ? ok({ nextCursor: result.nextCursor, sessions: result.sessions })
      : fail(ERROR_CODES.invalidParams, "invalid native session cursor");
  }

  /** `nativeSession.read`: one Claude session as neutral turns, with its sub-agents. */
  public async readNativeSession(sessionId: string): Promise<OperationResult<NativeRead>> {
    const result = await this.native.read(sessionId);
    return result.status === "ok"
      ? ok(result.value)
      : fail(ERROR_CODES.invalidRequest, nativeSessionNotFoundMessage(sessionId));
  }

  // ------------------------------------------------------------- views

  private subjectOf(state: ThreadState): Parameters<ThreadHistory["turns"]>[0] {
    return {
      appThreadId: asAppThreadId(state.appThreadId),
      cwd: state.cwd,
      sessionIds: state.sessionIds,
      turns: state.turns,
    };
  }

  private viewOf(entry: ThreadEntry, sessions: readonly StoredSession[]): ThreadView {
    const session = entry.session;
    return {
      appThreadId: entry.state.appThreadId,
      livePrompt: livePrompt(session.activeSnapshot()),
      recordedModel: null,
      sessions,
      state: entry.state,
      status: this.entryStatus(entry),
    };
  }

  private cachedSessions(state: ThreadState): readonly StoredSession[] {
    return state.sessionIds.flatMap((sessionId) => {
      const session = this.deps.catalog.cached(sessionId);
      return session === null ? [] : [session];
    });
  }

  private async freshSessions(state: ThreadState): Promise<readonly StoredSession[]> {
    const cwd = state.cwd.length > 0 ? state.cwd : null;
    const sessions = await Promise.all(
      state.sessionIds.map(async (sessionId) => this.deps.catalog.refresh({ cwd, sessionId })),
    );
    return sessions.filter((session) => session !== null);
  }

  private project(entry: ThreadEntry): AgentThread {
    return projectThread(this.viewOf(entry, this.cachedSessions(entry.state)));
  }

  private entryStatus(entry: ThreadEntry): ThreadView["status"] {
    const session = entry.session;
    if (session.activeTurnId !== null) {
      return "active";
    }
    if (session.isLive) {
      return "idle";
    }
    return this.openElsewhere.isHeld(currentSessionId(entry.state)) ? "openElsewhere" : "notLoaded";
  }

  private discoveredView(session: StoredSession): ThreadView {
    return {
      appThreadId: session.sessionId,
      livePrompt: null,
      recordedModel: this.recordedModelOf(session.sessionId),
      sessions: [session],
      state: null,
      status: this.openElsewhere.isHeld(session.sessionId) ? "openElsewhere" : "notLoaded",
    };
  }

  private async resolve(appThreadId: string): Promise<Resolved> {
    const entry = this.registry.get(appThreadId);
    if (entry !== null) {
      return isDeleted(entry.state) ? { entry, type: "deleted" } : { entry, type: "entry" };
    }
    // A replacement session belongs to its thread and is not a thread itself.
    if (!UUID.test(appThreadId) || this.registry.ownerOf(appThreadId) !== null) {
      return { type: "missing" };
    }
    const session = await this.deps.catalog.refresh({ cwd: null, sessionId: appThreadId });
    return session === null ? { type: "missing" } : { session, type: "discovered" };
  }

  private async currentView(
    resolved: Resolved & { readonly type: "discovered" | "entry" },
  ): Promise<ThreadView> {
    if (resolved.type === "entry") {
      return this.viewOf(resolved.entry, await this.freshSessions(resolved.entry.state));
    }
    await this.recordedModels.load(resolved.session);
    return this.discoveredView(resolved.session);
  }

  /** Catalog id of the session's last answering model, from the last read. */
  private recordedModelOf(sessionId: string): string | null {
    const recorded = this.recordedModels.cached(sessionId);
    return recorded === null ? null : this.deps.models.idFor(recorded);
  }

  /** Host metadata for a session CodeWide has not touched yet. */
  private adopt(session: StoredSession, presence: ThreadState["presence"]): ThreadEntry {
    const existing = this.registry.get(session.sessionId);
    if (existing !== null) {
      return existing;
    }
    const createdAt = seconds(session.createdAtMs ?? session.lastModifiedMs);
    return this.registry.add({
      appThreadId: session.sessionId,
      createdAt,
      cwd: session.cwd ?? "",
      origin: "discovered",
      pendingSettings: null,
      presence,
      recencyAt: null,
      sessionIds: [session.sessionId],
      sessionStarted: true,
      // CodeWide continues the session with the model it last answered with.
      settings: discoveredSettings(this.recordedModelOf(session.sessionId)),
      title: { type: "none" },
      // A discovered session may hold usage the host never measured.
      totalCost: { type: "unknown" },
      totalUsage: ZERO_USAGE,
      turns: [],
      updatedAt: seconds(session.lastModifiedMs),
      usageBaseline: { type: "unknown" },
      version: THREAD_STATE_VERSION,
    });
  }

  /** The entry of a listed thread, adopting a discovered session when needed. */
  private async entryFor(appThreadId: string): Promise<ThreadEntry | null> {
    const resolved = await this.resolve(appThreadId);
    switch (resolved.type) {
      case "entry":
        return resolved.entry;
      case "discovered":
        await this.recordedModels.load(resolved.session);
        return this.adopt(resolved.session, { archived: false, type: "listed" });
      case "deleted":
      case "missing":
        return null;
      default:
        return unreachable(resolved);
    }
  }

  private emitUpdated(thread: AgentThread): void {
    this.deps.emit({ thread, type: "thread.updated" });
  }

  /** Applies a pending title once Claude created the session, then refreshes its metadata. */
  private onSessionReady(entry: ThreadEntry): void {
    const before = JSON.stringify(this.project(entry));
    this.applyPendingTitle(entry)
      .then(async () => this.freshSessions(entry.state))
      .then(() => {
        const thread = this.project(entry);
        if (!isDeleted(entry.state) && JSON.stringify(thread) !== before) {
          this.emitUpdated(thread);
        }
      })
      .catch((error: unknown) => {
        this.deps.logger.log("warn", "claude session metadata refresh failed", {
          appThreadId: entry.state.appThreadId,
          err: error instanceof Error ? error : new Error(String(error)),
        });
      });
  }

  private async applyPendingTitle(entry: ThreadEntry): Promise<void> {
    const title = entry.state.title;
    if (title.type !== "pending") {
      return;
    }
    const sessionId = currentSessionId(entry.state);
    await this.deps.sessionStore.rename({ cwd: entry.state.cwd, sessionId }, title.name);
    this.deps.catalog.rememberTitle(sessionId, title.name);
    if (entry.state.title === title) {
      this.registry.commit(entry, { ...entry.state, title: { type: "none" } });
    }
  }

  // ---------------------------------------------------------- operations

  public create(
    appThreadId: string | null,
    cwd: string,
    settings: ThreadSettings,
  ): OperationResult<AgentThread> {
    if (appThreadId === null || !UUID.test(appThreadId)) {
      return fail(ERROR_CODES.invalidParams, "Claude threads need a host-minted UUID appThreadId");
    }
    if (!isProfileId(settings.permissionProfile)) {
      return fail(ERROR_CODES.invalidParams, unsupportedProfileMessage(settings.permissionProfile));
    }
    const existing = this.registry.get(appThreadId);
    if (existing !== null) {
      return isDeleted(existing.state) ? notFound(appThreadId) : ok(this.project(existing));
    }
    const now = seconds(this.deps.nowMs());
    const entry = this.registry.add({
      appThreadId,
      createdAt: now,
      cwd,
      origin: "created",
      pendingSettings: null,
      presence: { archived: false, type: "listed" },
      recencyAt: null,
      sessionIds: [appThreadId],
      sessionStarted: false,
      settings: { ...settings, serviceTier: null },
      title: { type: "none" },
      ...NEW_THREAD_USAGE,
      turns: [],
      updatedAt: now,
      version: THREAD_STATE_VERSION,
    });
    const thread = this.project(entry);
    this.emitUpdated(thread);
    return ok(thread);
  }

  public async read(
    appThreadId: string,
  ): Promise<
    OperationResult<{ readonly activeTurnId: TurnId | null; readonly thread: AgentThread }>
  > {
    const resolved = await this.resolve(appThreadId);
    if (!isListed(resolved)) {
      return notFound(appThreadId);
    }
    // Opening a thread is when a client needs to know whether it can write;
    // the read itself never waits for the CLI.
    this.openElsewhere.refreshInBackground();
    const thread = projectThread(await this.currentView(resolved));
    return ok({
      activeTurnId: resolved.type === "entry" ? resolved.entry.session.activeTurnId : null,
      thread,
    });
  }

  public async owns(appThreadId: string): Promise<boolean> {
    const resolved = await this.resolve(appThreadId);
    return resolved.type === "entry" || resolved.type === "discovered";
  }

  public async list(params: ThreadListParams): Promise<
    OperationResult<{
      readonly nextCursor: string | null;
      readonly threads: readonly AgentThread[];
    }>
  > {
    const snapshot = await this.deps.catalog.snapshot();
    const rows: ListRow[] = [];
    const claimed = new Set<string>();
    for (const entry of this.registry.all()) {
      for (const sessionId of entry.state.sessionIds) {
        claimed.add(sessionId);
      }
      if (!isDeleted(entry.state)) {
        const sessions = entry.state.sessionIds.flatMap((sessionId) => {
          const session = snapshot.sessions.get(sessionId);
          return session === undefined ? [] : [session];
        });
        rows.push(listRow(this.viewOf(entry, sessions)));
      }
    }
    for (const sessionId of snapshot.interactive) {
      const session = snapshot.sessions.get(sessionId);
      if (session !== undefined && !claimed.has(sessionId)) {
        rows.push(listRow(this.discoveredView(session)));
      }
    }
    const result = listThreads(rows, params);
    return result.status === "ok"
      ? ok({ nextCursor: result.nextCursor, threads: result.threads })
      : fail(ERROR_CODES.invalidParams, result.message);
  }

  public async turns(
    query: TurnsQuery,
  ): Promise<
    OperationResult<{ readonly nextCursor: string | null; readonly turns: readonly AgentTurn[] }>
  > {
    const resolved = await this.resolve(query.appThreadId);
    return isListed(resolved)
      ? pageTurns(await this.allTurns(resolved), query)
      : notFound(query.appThreadId);
  }

  private async allTurns(
    resolved: Resolved & { readonly type: "discovered" | "entry" },
  ): Promise<readonly AgentTurn[]> {
    if (resolved.type === "discovered") {
      const session = resolved.session;
      return this.history.turns({
        appThreadId: asAppThreadId(session.sessionId),
        cwd: session.cwd ?? "",
        sessionIds: [session.sessionId],
        turns: [],
      });
    }
    const state = resolved.entry.state;
    const turns = await this.history.turns(this.subjectOf(state));
    return withActiveTurn(turns, resolved.entry.session.activeSnapshot(), state.turns);
  }

  public async update(
    appThreadId: string,
    change: ThreadChange,
  ): Promise<OperationResult<AgentThread | null>> {
    switch (change.type) {
      case "name":
        return this.rename(appThreadId, change.name);
      case "archived":
        return this.archive(appThreadId, change.archived);
      case "deleted":
        return this.delete(appThreadId);
      case "settings":
        return this.changeSettings(appThreadId, change);
      default:
        return unreachable(change);
    }
  }

  private async rename(
    appThreadId: string,
    requested: string | null,
  ): Promise<OperationResult<AgentThread>> {
    const resolved = await this.resolve(appThreadId);
    if (!isListed(resolved)) {
      return notFound(appThreadId);
    }
    const name = normalizedName(requested);
    const view = await this.currentView(resolved);
    const current = projectThread(view);
    if (current.name === name) {
      return ok(current);
    }
    const latest = view.sessions.at(-1);
    const thread =
      name === null || latest === undefined
        ? this.overrideTitle(
            resolved,
            name === null ? clearedTitle(latest?.title ?? null) : { name, type: "pending" },
          )
        : await this.renameSession(resolved, { latest, name, view });
    this.emitUpdated(thread);
    return ok(thread);
  }

  /** Keeps a title Claude cannot hold in the host's metadata. */
  private overrideTitle(resolved: ListedThread, title: TitleOverride): AgentThread {
    const entry =
      resolved.type === "entry"
        ? resolved.entry
        : this.adopt(resolved.session, { archived: false, type: "listed" });
    this.registry.commit(entry, { ...entry.state, title });
    return this.project(entry);
  }

  /** Renames the thread's latest session in Claude's store. */
  private async renameSession(
    resolved: ListedThread,
    rename: { readonly latest: StoredSession; readonly name: string; readonly view: ThreadView },
  ): Promise<AgentThread> {
    const { latest, name, view } = rename;
    await this.deps.sessionStore.rename({ cwd: latest.cwd, sessionId: latest.sessionId }, name);
    this.deps.catalog.rememberTitle(latest.sessionId, name);
    const entry = resolved.type === "entry" ? resolved.entry : null;
    if (entry !== null && entry.state.title.type !== "none") {
      this.registry.commit(entry, { ...entry.state, title: { type: "none" } });
    }
    const sessions = view.sessions.map((session) =>
      session.sessionId === latest.sessionId ? { ...session, title: name } : session,
    );
    return projectThread({ ...view, sessions, state: entry?.state ?? null });
  }

  private async archive(
    appThreadId: string,
    archived: boolean,
  ): Promise<OperationResult<AgentThread>> {
    const entry = await this.entryFor(appThreadId);
    if (entry === null) {
      return notFound(appThreadId);
    }
    if (isArchived(entry.state) !== archived) {
      this.registry.commit(entry, { ...entry.state, presence: { archived, type: "listed" } });
      this.emitUpdated(this.project(entry));
    }
    return ok(this.project(entry));
  }

  private async delete(appThreadId: string): Promise<OperationResult<null>> {
    const resolved = await this.resolve(appThreadId);
    if (resolved.type === "missing") {
      return notFound(appThreadId);
    }
    const deletedAt = seconds(this.deps.nowMs());
    const entry =
      resolved.type === "discovered"
        ? this.adopt(resolved.session, { deletedAt, type: "deleted" })
        : resolved.entry;
    if (!isDeleted(entry.state)) {
      entry.session.dispose();
      this.registry.commit(entry, { ...entry.state, presence: { deletedAt, type: "deleted" } });
    }
    await this.removeSessions(entry.state);
    return ok(null);
  }

  /** Deletes the thread's sessions from Claude's store; failures are logged and retried by a repeated delete. */
  private async removeSessions(state: ThreadState): Promise<void> {
    const cwd = state.cwd.length > 0 ? state.cwd : null;
    await Promise.all(
      state.sessionIds.map(async (sessionId) => {
        try {
          await this.deps.sessionStore.remove({ cwd, sessionId });
        } catch (error) {
          this.deps.logger.log("error", "claude session could not be deleted", {
            appThreadId: state.appThreadId,
            claudeSessionId: sessionId,
            err: error instanceof Error ? error : new Error(String(error)),
          });
        }
        this.deps.catalog.forget(sessionId);
      }),
    );
  }

  private async changeSettings(
    appThreadId: string,
    change: Extract<ThreadChange, { readonly type: "settings" }>,
  ): Promise<OperationResult<AgentThread>> {
    const entry = await this.entryFor(appThreadId);
    if (entry === null) {
      return notFound(appThreadId);
    }
    const current = entry.state.pendingSettings ?? entry.state.settings;
    const next: ThreadSettings = {
      effort: change.effort ?? current.effort,
      model: change.model ?? current.model,
      permissionProfile: change.permissionProfile ?? current.permissionProfile,
      serviceTier: null,
    };
    if (!isProfileId(next.permissionProfile)) {
      return fail(ERROR_CODES.invalidParams, unsupportedProfileMessage(next.permissionProfile));
    }
    entry.session.updateSettings(next);
    return ok(this.project(entry));
  }

  /** The entry a turn can run in: listed, with a working directory. */
  private async turnEntry(appThreadId: string): Promise<OperationResult<ThreadEntry>> {
    const entry = await this.entryFor(appThreadId);
    if (entry === null) {
      return notFound(appThreadId);
    }
    if (entry.state.cwd.length === 0) {
      return fail(ERROR_CODES.invalidRequest, "the Claude session has no working directory");
    }
    // A session that never started cannot be held; a live one is this host's.
    if (
      entry.state.sessionStarted &&
      !entry.session.isLive &&
      (await this.openElsewhere.check(currentSessionId(entry.state)))
    ) {
      return fail(ERROR_CODES.invalidRequest, OPEN_ELSEWHERE_MESSAGE);
    }
    return ok(entry);
  }

  /** `clientTools` replaces the thread's client tools when the turn starts; `null` keeps them. */
  /** Replaces the client tools of a thread the host keeps metadata for (`thread.create`). */
  public useClientTools(appThreadId: string, clientTools: readonly ClientToolSpec[]): void {
    this.registry.get(appThreadId)?.session.useClientTools(clientTools);
  }

  public async startTurn(
    appThreadId: string,
    message: UserMessage,
    clientTools: readonly ClientToolSpec[] | null = null,
  ): Promise<OperationResult<TurnStartResult>> {
    const entry = await this.turnEntry(appThreadId);
    if (entry.status === "error") {
      return entry;
    }
    if (clientTools !== null) {
      entry.value.session.useClientTools(clientTools);
    }
    return ok(entry.value.session.startTurn({ ...message, kind: "user" }));
  }

  public async compact(appThreadId: string): Promise<OperationResult<Record<string, never>>> {
    const entry = await this.turnEntry(appThreadId);
    if (entry.status === "error") {
      return entry;
    }
    const result = entry.value.session.startTurn({ kind: "compact" });
    return result.type === "busy"
      ? fail(ERROR_CODES.invalidRequest, "thread has an active turn")
      : ok({});
  }

  public async steer(
    appThreadId: string,
    expectedTurnId: TurnId,
    message: UserMessage,
  ): Promise<OperationResult<{ readonly turnId: TurnId }>> {
    const resolved = await this.resolve(appThreadId);
    if (!isListed(resolved)) {
      return notFound(appThreadId);
    }
    const outcome =
      resolved.type === "entry"
        ? resolved.entry.session.steer(expectedTurnId, message)
        : ({ message: "expected turn is not active", status: "error" } as const);
    return outcome.status === "ok"
      ? ok({ turnId: outcome.turnId })
      : fail(ERROR_CODES.invalidRequest, outcome.message);
  }

  /** Whether `turnId` is the active turn, an indexed turn or a turn of the stored history. */
  private async isKnownTurn(entry: ThreadEntry, turnId: TurnId): Promise<boolean> {
    if (turnId === entry.session.activeTurnId || entry.session.isIndexedTurn(turnId)) {
      return true;
    }
    const turns = await this.history.turns(this.subjectOf(entry.state));
    return turns.some((turn) => turn.turnId === turnId);
  }

  public async interrupt(
    appThreadId: string,
    turnId: TurnId | null,
  ): Promise<OperationResult<Record<string, never>>> {
    const resolved = await this.resolve(appThreadId);
    if (!isListed(resolved)) {
      return notFound(appThreadId);
    }
    if (resolved.type === "discovered") {
      return ok({});
    }
    const session = resolved.entry.session;
    const needsLookup = turnId !== null && session.activeTurnId !== null;
    const known = !needsLookup || (await this.isKnownTurn(resolved.entry, turnId));
    const outcome = session.interrupt(turnId, known);
    return outcome.status === "ok" ? ok({}) : fail(ERROR_CODES.invalidRequest, outcome.message);
  }

  public async respond(
    appThreadId: string,
    requestId: NativeRequestId,
    response: RuntimeResponse,
  ): Promise<OperationResult<Record<string, never>>> {
    const resolved = await this.resolve(appThreadId);
    if (!isListed(resolved)) {
      return notFound(appThreadId);
    }
    const responded =
      resolved.type === "entry" && resolved.entry.session.respond(requestId, response);
    return responded ? ok({}) : fail(ERROR_CODES.invalidRequest, "request is not pending");
  }
}
