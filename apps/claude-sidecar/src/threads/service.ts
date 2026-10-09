/**
 * Thread registry: the operations of the `codewide-agent` v1 protocol over
 * the journal and the live sessions.
 *
 * Repeat semantics (research canvas O contract table): `thread.create` with
 * the same id returns the existing thread; name/archive/unarchive/settings
 * repeats answer with the current thread and emit `thread.updated` only on a
 * real change; delete is idempotent through a tombstone; `turn.interrupt`
 * answers in every state. Errors use the protocol's codes and texts.
 */

import type {
  AgentEvent,
  AgentItem,
  AgentThread,
  AgentTurn,
  AppThreadId,
  ClientMessageId,
  ItemsView,
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
import { asAppThreadId, ERROR_CODES, PROVIDER_ID, threadNotFoundMessage } from "../protocol.js";
import type { ClaudeRuntime } from "../claude/port.js";
import type { Logger } from "../log.js";
import { Journal, ZERO_USAGE, type ThreadRecord, type TurnRecord } from "../journal/journal.js";
import { failOpenItem } from "../mapping/tools.js";
import { isProfileId, unsupportedProfileMessage } from "../permissions/profiles.js";
import { listThreads } from "./listing.js";
import { ClaudeSession, type SessionDeps, type ThreadPort } from "./session.js";

export type OperationResult<Value> =
  | { readonly status: "ok"; readonly value: Value }
  | { readonly status: "error"; readonly code: number; readonly message: string };

const ok = <Value>(value: Value): OperationResult<Value> => ({ status: "ok", value });
const fail = <Value>(code: number, message: string): OperationResult<Value> => ({ status: "error", code, message });

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export interface ServiceDeps extends Omit<SessionDeps, "liveSessions"> {
  readonly journal: Journal;
  readonly runtime: ClaudeRuntime;
  readonly logger: Logger;
}

interface ThreadEntry {
  record: ThreadRecord;
  readonly session: ClaudeSession;
}

function isInProgress(item: AgentItem): boolean {
  return "status" in item && item.status === "inProgress";
}

export class ThreadService {
  private readonly threads = new Map<string, ThreadEntry>();
  private readonly liveSessions = { count: 0 };

  constructor(private readonly deps: ServiceDeps) {}

  /** Loads the journal and finalizes turns a previous process left in progress. */
  load(): readonly AgentEvent[] {
    const events: AgentEvent[] = [];
    const records = this.deps.journal.loadThreads((appThreadId, error) =>
      this.deps.logger.log("error", "journal thread record is unreadable", { appThreadId, err: error }),
    );
    for (const record of records) {
      this.register(record);
      if (record.deletedAt !== null) continue;
      for (const turnRecord of this.deps.journal.loadTurns(record.appThreadId)) {
        if (turnRecord.turn.status !== "inProgress") continue;
        const turn: AgentTurn = {
          ...turnRecord.turn,
          status: "interrupted",
          completedAt: Math.floor(this.deps.nowMs() / 1000),
          items: turnRecord.turn.items.map((item) => (isInProgress(item) ? failOpenItem(item) : item)),
        };
        this.deps.journal.writeTurn(record.appThreadId, { ...turnRecord, turn });
        events.push({ type: "turn.completed", appThreadId: asAppThreadId(record.appThreadId), turn });
        this.deps.logger.log("info", "finalized a turn left in progress by a previous sidecar", {
          appThreadId: record.appThreadId,
          turnId: turn.turnId,
        });
      }
    }
    return events;
  }

  private register(record: ThreadRecord): ThreadEntry {
    const appThreadId = asAppThreadId(record.appThreadId);
    const holder: { entry: ThreadEntry | null } = { entry: null };
    const port: ThreadPort = {
      appThreadId,
      record: () => holder.entry?.record ?? record,
      update: (change) => {
        const entry = holder.entry;
        if (entry === null) return;
        entry.record = change(entry.record);
        this.deps.journal.writeThread(entry.record);
      },
      writeTurn: (turnRecord) => this.deps.journal.writeTurn(record.appThreadId, turnRecord),
      emitThreadUpdated: () => {
        const entry = holder.entry;
        if (entry !== null) this.deps.emit({ type: "thread.updated", thread: this.project(entry) });
      },
      historyLines: () => this.historyLines(record.appThreadId),
    };
    const session = new ClaudeSession(port, { ...this.deps, liveSessions: this.liveSessions });
    const entry: ThreadEntry = { record, session };
    holder.entry = entry;
    this.threads.set(record.appThreadId, entry);
    return entry;
  }

  private project(entry: ThreadEntry): AgentThread {
    const record = entry.record;
    return {
      appThreadId: asAppThreadId(record.appThreadId),
      provider: PROVIDER_ID,
      cwd: record.cwd,
      name: record.name,
      preview: record.preview,
      createdAt: record.createdAt,
      updatedAt: record.updatedAt,
      recencyAt: record.recencyAt,
      archived: record.archived,
      origin: "interactive",
      status: entry.session.activeTurnId !== null ? "active" : entry.session.isLive ? "idle" : "notLoaded",
      settings: record.pendingSettings ?? record.settings,
    };
  }

  private live(appThreadId: string): ThreadEntry | null {
    const entry = this.threads.get(appThreadId);
    return entry === undefined || entry.record.deletedAt !== null ? null : entry;
  }

  private historyLines(appThreadId: string): readonly string[] {
    const lines: string[] = [];
    for (const record of this.deps.journal.loadTurns(appThreadId)) {
      for (const item of record.turn.items) {
        if (item.type === "userMessage") {
          const text = item.content.flatMap((content) => (content.type === "text" ? [content.text] : [])).join("\n");
          if (text.length > 0) lines.push(`User: ${text}`);
        } else if (item.type === "agentMessage" && item.phase === "final") {
          lines.push(`Claude: ${item.text}`);
        }
      }
    }
    return lines;
  }

  get liveSessionCount(): number {
    return this.liveSessions.count;
  }

  // ---------------------------------------------------------- operations

  create(appThreadId: string | null, cwd: string, settings: ThreadSettings): OperationResult<AgentThread> {
    if (appThreadId === null || !UUID.test(appThreadId)) {
      return fail(ERROR_CODES.invalidParams, "Claude threads need a host-minted UUID appThreadId");
    }
    if (!isProfileId(settings.permissionProfile)) {
      return fail(ERROR_CODES.invalidParams, unsupportedProfileMessage(settings.permissionProfile));
    }
    const existing = this.threads.get(appThreadId);
    if (existing !== undefined) {
      return existing.record.deletedAt === null ? ok(this.project(existing)) : fail(ERROR_CODES.invalidRequest, threadNotFoundMessage(appThreadId));
    }
    const now = Math.floor(this.deps.nowMs() / 1000);
    const record: ThreadRecord = {
      version: 1,
      appThreadId,
      claudeSessionId: appThreadId,
      sessionStarted: false,
      cwd,
      name: null,
      preview: "",
      firstUserMessage: null,
      createdAt: now,
      updatedAt: now,
      recencyAt: null,
      archived: false,
      deletedAt: null,
      settings: { ...settings, serviceTier: null },
      pendingSettings: null,
      totalUsage: ZERO_USAGE,
      turnCount: 0,
    };
    this.deps.journal.writeThread(record);
    const entry = this.register(record);
    const thread = this.project(entry);
    this.deps.emit({ type: "thread.updated", thread });
    return ok(thread);
  }

  read(appThreadId: string): OperationResult<{ readonly thread: AgentThread; readonly activeTurnId: TurnId | null }> {
    const entry = this.live(appThreadId);
    if (entry === null) return fail(ERROR_CODES.invalidRequest, threadNotFoundMessage(appThreadId));
    return ok({ thread: this.project(entry), activeTurnId: entry.session.activeTurnId });
  }

  owns(appThreadId: string): boolean {
    return this.live(appThreadId) !== null;
  }

  list(params: ThreadListParams): OperationResult<{ readonly threads: readonly AgentThread[]; readonly nextCursor: string | null }> {
    const entries = [...this.threads.values()].filter((entry) => entry.record.deletedAt === null);
    const byId = new Map(entries.map((entry) => [entry.record.appThreadId, entry.record]));
    const result = listThreads(
      entries.map((entry) => this.project(entry)),
      params,
      (thread) => byId.get(thread.appThreadId)?.firstUserMessage === null,
      (thread) => {
        const record = byId.get(thread.appThreadId);
        return record?.name ?? record?.firstUserMessage ?? "";
      },
    );
    return result.status === "ok" ? ok({ threads: result.threads, nextCursor: result.nextCursor }) : fail(ERROR_CODES.invalidParams, result.message);
  }

  turns(
    appThreadId: string,
    cursor: string | null,
    limit: number,
    direction: SortDirection,
    itemsView: ItemsView,
  ): OperationResult<{ readonly turns: readonly AgentTurn[]; readonly nextCursor: string | null }> {
    const entry = this.live(appThreadId);
    if (entry === null) return fail(ERROR_CODES.invalidRequest, threadNotFoundMessage(appThreadId));
    const active = entry.session.activeSnapshot();
    const records: TurnRecord[] = [...this.deps.journal.loadTurns(appThreadId)];
    const all = records.map((record) => (active !== null && record.seq === active.seq ? active.turn : record.turn));
    const ordered = direction === "asc" ? all : [...all].reverse();
    const start = cursor === null ? 0 : ordered.findIndex((turn) => turn.turnId === cursor) + 1;
    if (cursor !== null && start === 0) return fail(ERROR_CODES.invalidParams, "invalid turns cursor");
    const size = Math.max(1, Math.min(limit, 200));
    const page = ordered.slice(start, start + size).map((turn) => ({ ...turn, items: viewItems(turn.items, itemsView) }));
    const last = page.at(-1);
    return ok({ turns: page, nextCursor: last !== undefined && start + size < ordered.length ? last.turnId : null });
  }

  update(appThreadId: string, change: ThreadChange): OperationResult<AgentThread | null> {
    const entry = this.threads.get(appThreadId);
    if (entry === undefined) return fail(ERROR_CODES.invalidRequest, threadNotFoundMessage(appThreadId));
    if (entry.record.deletedAt !== null) {
      return change.type === "deleted" ? ok(null) : fail(ERROR_CODES.invalidRequest, threadNotFoundMessage(appThreadId));
    }
    const write = (next: ThreadRecord): void => {
      entry.record = next;
      this.deps.journal.writeThread(next);
      this.deps.emit({ type: "thread.updated", thread: this.project(entry) });
    };
    switch (change.type) {
      case "name":
        if (entry.record.name !== change.name) write({ ...entry.record, name: change.name });
        return ok(this.project(entry));
      case "archived":
        if (entry.record.archived !== change.archived) write({ ...entry.record, archived: change.archived });
        return ok(this.project(entry));
      case "deleted":
        entry.session.dispose();
        entry.record = { ...entry.record, deletedAt: Math.floor(this.deps.nowMs() / 1000) };
        this.deps.journal.writeThread(entry.record);
        return ok(null);
      case "settings": {
        const current = entry.record.pendingSettings ?? entry.record.settings;
        const next: ThreadSettings = {
          model: change.model ?? current.model,
          effort: change.effort ?? current.effort,
          permissionProfile: change.permissionProfile ?? current.permissionProfile,
          serviceTier: null,
        };
        if (!isProfileId(next.permissionProfile)) {
          return fail(ERROR_CODES.invalidParams, unsupportedProfileMessage(next.permissionProfile));
        }
        entry.session.updateSettings(next);
        return ok(this.project(entry));
      }
    }
  }

  startTurn(appThreadId: string, clientMessageId: ClientMessageId | null, input: readonly UserContent[]): OperationResult<TurnStartResult> {
    const entry = this.live(appThreadId);
    if (entry === null) return fail(ERROR_CODES.invalidRequest, threadNotFoundMessage(appThreadId));
    return ok(entry.session.startTurn({ kind: "user", clientMessageId, input }));
  }

  compact(appThreadId: string): OperationResult<Record<string, never>> {
    const entry = this.live(appThreadId);
    if (entry === null) return fail(ERROR_CODES.invalidRequest, threadNotFoundMessage(appThreadId));
    const result = entry.session.startTurn({ kind: "compact" });
    return result.type === "busy" ? fail(ERROR_CODES.invalidRequest, "thread has an active turn") : ok({});
  }

  steer(appThreadId: string, expectedTurnId: TurnId, clientMessageId: ClientMessageId | null, input: readonly UserContent[]): OperationResult<{ readonly turnId: TurnId }> {
    const entry = this.live(appThreadId);
    if (entry === null) return fail(ERROR_CODES.invalidRequest, threadNotFoundMessage(appThreadId));
    const outcome = entry.session.steer(expectedTurnId, clientMessageId, input);
    return outcome.status === "ok" ? ok({ turnId: outcome.turnId }) : fail(ERROR_CODES.invalidRequest, outcome.message);
  }

  interrupt(appThreadId: string, turnId: TurnId | null): OperationResult<Record<string, never>> {
    const entry = this.live(appThreadId);
    if (entry === null) return fail(ERROR_CODES.invalidRequest, threadNotFoundMessage(appThreadId));
    const outcome = entry.session.interrupt(turnId, (candidate) =>
      this.deps.journal.loadTurns(appThreadId).some((record) => record.turn.turnId === candidate),
    );
    return outcome.status === "ok" ? ok({}) : fail(ERROR_CODES.invalidRequest, outcome.message);
  }

  respond(appThreadId: string, requestId: NativeRequestId, response: RuntimeResponse): OperationResult<Record<string, never>> {
    const entry = this.live(appThreadId);
    if (entry === null) return fail(ERROR_CODES.invalidRequest, threadNotFoundMessage(appThreadId));
    return entry.session.respond(requestId, response) ? ok({}) : fail(ERROR_CODES.invalidRequest, "request is not pending");
  }

  /** Ends every live session (sidecar shutdown). */
  shutdown(): void {
    for (const entry of this.threads.values()) entry.session.dispose();
  }
}

function viewItems(items: readonly AgentItem[], view: ItemsView): readonly AgentItem[] {
  if (view === "full") return items;
  if (view === "notLoaded") return [];
  return items.filter((item) => item.type === "userMessage" || (item.type === "agentMessage" && item.phase === "final"));
}

