/**
 * The live Claude session of one thread.
 *
 * Lifecycle: `Shell`/`Released` (no process) → `Active` (a turn runs) ↔
 * `Idle` (query open, no turn) → `Released` after idle release, interrupt
 * fallback or process loss. One long-lived query per thread is fed through
 * its input queue and read with `next()`. The first open uses the session id,
 * every later open resumes it.
 *
 * Rules owned here:
 * - `turn.start` on an active thread answers `busy`; it never steers.
 * - Steer is explicit and offers with `priority: "now"`; the `aborted_*`
 *   result a steer causes does not end the turn.
 * - Interrupt answers at once; if no `aborted_*` result arrives within the
 *   timeout the query is closed and the turn is finalized as interrupted.
 *   Open requests are resolved before `turn.completed`.
 * - A provider-started turn (background task wake) is a separate turn with
 *   origin `provider` and no user message.
 * - A lost session is replaced once per turn by a new session whose first
 *   offer carries a bounded history prefix; a second loss fails the turn.
 * - Process loss fails only this thread's active turn.
 * - Idle release never happens with an active turn or a pending request;
 *   background tasks defer it up to a bound.
 */

import type {
  AgentEvent,
  AppThreadId,
  ClientMessageId,
  NativeRequestId,
  RuntimeRequest,
  RuntimeResponse,
  ThreadSettings,
  TokenUsage,
  TurnId,
  TurnStartResult,
  UserContent,
} from "../protocol.js";
import { asItemId, asTurnId, EXPECTED_TURN_NOT_ACTIVE } from "../protocol.js";
import type { ClaudeQuery, ClaudeRuntime, PermissionRequest, PromptContent } from "../claude/port.js";
import type { Logger } from "../log.js";
import { classifyFrame, type ClaudeFrame } from "../mapping/frames.js";
import { isInterruption, isLostSession, PROCESS_EXITED_MESSAGE, turnOutcome, type TurnOutcome } from "../mapping/result.js";
import { toolDisposition } from "../mapping/tools.js";
import {
  approvalDecision,
  approvalRequest,
  cancelledDecision,
  EXIT_PLAN_MESSAGE,
  readOnlyDenyMessage,
  userInputDecision,
  userInputQuestions,
  type PermissionDecision,
} from "../permissions/approvals.js";
import { isProfileId, profileAllowsTool, profileOptions } from "../permissions/profiles.js";
import type { PromptRecord, ThreadRecord, TurnRecord } from "../journal/journal.js";
import { ZERO_USAGE } from "../journal/journal.js";
import { contentText, historyPrefix, promptContent } from "./prompt.js";
import { TurnBuilder } from "./turnBuilder.js";

/** E-STEER-UUID switch: offer steers with a fresh uuid (canvas default) or without (fallback). */
export const STEER_WITH_UUID = true;

/** What a session needs from its thread owner. */
export interface ThreadPort {
  readonly appThreadId: AppThreadId;
  readonly record: () => ThreadRecord;
  /** Applies and journals a record change. */
  readonly update: (change: (record: ThreadRecord) => ThreadRecord) => void;
  readonly writeTurn: (record: TurnRecord) => void;
  /** Emits `thread.updated` with the current projection. */
  readonly emitThreadUpdated: () => void;
  /** User messages and final answers of completed turns, oldest first. */
  readonly historyLines: () => readonly string[];
}

export interface SessionDeps {
  readonly runtime: ClaudeRuntime;
  readonly logger: Logger;
  readonly emit: (event: AgentEvent) => void;
  readonly nowMs: () => number;
  readonly newUuid: () => string;
  readonly interruptTimeoutMs: number;
  readonly idleReleaseMs: number;
  readonly backgroundDeferMaxMs: number;
  /** Shared live-process counter, logged on every open and release. */
  readonly liveSessions: { count: number };
}

interface PendingRequest {
  readonly requestId: NativeRequestId;
  readonly settle: (response: RuntimeResponse | null) => void;
}

interface ActiveTurn {
  readonly builder: TurnBuilder;
  readonly seq: number;
  readonly prompts: PromptRecord[];
  /** The first offer, kept to resend after a lost session. */
  readonly firstOffer: readonly PromptContent[] | null;
  interruptRequested: boolean;
  interruptTimer: NodeJS.Timeout | null;
  /** Steers whose `aborted_*` restart result must not end the turn. */
  pendingSteerAborts: number;
  sessionReplacements: number;
  /** E-INT-TOOL fallback: release the process after this turn. */
  releaseAfter: boolean;
}

export type SteerOutcome =
  | { readonly status: "ok"; readonly turnId: TurnId }
  | { readonly status: "error"; readonly message: string };

export type InterruptOutcome = { readonly status: "ok" } | { readonly status: "error"; readonly message: string };

const usageOf = (figures: { readonly inputTokens: number; readonly cachedInputTokens: number; readonly outputTokens: number }): TokenUsage => ({
  inputTokens: figures.inputTokens,
  cachedInputTokens: figures.cachedInputTokens,
  outputTokens: figures.outputTokens,
  reasoningOutputTokens: 0,
  totalTokens: figures.inputTokens + figures.outputTokens,
});

const addUsage = (left: TokenUsage, right: TokenUsage): TokenUsage => ({
  inputTokens: left.inputTokens + right.inputTokens,
  cachedInputTokens: left.cachedInputTokens + right.cachedInputTokens,
  outputTokens: left.outputTokens + right.outputTokens,
  reasoningOutputTokens: left.reasoningOutputTokens + right.reasoningOutputTokens,
  totalTokens: left.totalTokens + right.totalTokens,
});

export class ClaudeSession {
  private query: ClaudeQuery | null = null;
  private generation = 0;
  private active: ActiveTurn | null = null;
  private readonly pending = new Map<string, PendingRequest>();
  private backgroundTasks = 0;
  private mcpServers: readonly string[] = [];
  private idleTimer: NodeJS.Timeout | null = null;
  private idleSinceMs: number | null = null;
  private disposed = false;

  constructor(
    private readonly thread: ThreadPort,
    private readonly deps: SessionDeps,
  ) {}

  get activeTurnId(): TurnId | null {
    return this.active?.builder.turnId ?? null;
  }

  get isLive(): boolean {
    return this.query !== null;
  }

  get pendingRequestCount(): number {
    return this.pending.size;
  }

  /** The in-progress turn, for `thread.turns`. */
  activeSnapshot(): { readonly seq: number; readonly turn: ReturnType<TurnBuilder["snapshot"]> } | null {
    return this.active === null ? null : { seq: this.active.seq, turn: this.active.builder.snapshot() };
  }

  /**
   * Emits events in order. When an item started or completed, the in-progress
   * turn is journaled again first, so a sidecar restart can finalize the turn
   * with every item the client has already seen.
   */
  private emitAll(events: readonly AgentEvent[]): void {
    const active = this.active;
    if (active !== null && events.some((event) => event.type === "item.started" || event.type === "item.completed")) {
      this.thread.writeTurn({ version: 1, seq: active.seq, turn: active.builder.snapshot(), prompts: active.prompts });
    }
    for (const event of events) this.deps.emit(event);
  }

  private log(level: "debug" | "info" | "warn" | "error", msg: string, fields: Record<string, string | number | boolean | null | Error> = {}): void {
    this.deps.logger.log(level, msg, { appThreadId: this.thread.appThreadId, ...fields });
  }

  // ---------------------------------------------------------------- turns

  /** Starts a user turn (or the `/compact` turn). Never steers. */
  startTurn(
    request:
      | { readonly kind: "user"; readonly clientMessageId: ClientMessageId | null; readonly input: readonly UserContent[] }
      | { readonly kind: "compact" },
  ): TurnStartResult {
    if (this.active !== null) return { type: "busy", activeTurnId: this.active.builder.turnId };
    this.clearIdleTimer();
    this.applyPendingSettingsIfPossible();
    const turnId = asTurnId(this.deps.newUuid());
    const offerUuid = this.deps.newUuid();
    const firstOffer: PromptContent[] =
      request.kind === "user" ? promptContent(request.input) : [{ type: "text", text: "/compact" }];
    const prompts: PromptRecord[] = [{ uuid: offerUuid, clientMessageId: request.kind === "user" ? request.clientMessageId : null }];
    this.beginTurn(turnId, request.kind === "user" ? "user" : "provider", prompts, firstOffer, request.kind === "user" ? request : null);
    this.ensureQuery().offer({ uuid: offerUuid, priority: null, content: firstOffer });
    return { type: "started", turnId };
  }

  private beginTurn(
    turnId: TurnId,
    origin: "user" | "provider",
    prompts: PromptRecord[],
    firstOffer: readonly PromptContent[] | null,
    userMessage: { readonly clientMessageId: ClientMessageId | null; readonly input: readonly UserContent[] } | null,
  ): void {
    const record = this.thread.record();
    const seq = record.turnCount + 1;
    const builder = new TurnBuilder({
      appThreadId: this.thread.appThreadId,
      turnId,
      origin,
      cwd: record.cwd,
      nowMs: this.deps.nowMs,
    });
    builder.setMcpServers(this.mcpServers);
    this.active = {
      builder,
      seq,
      prompts,
      firstOffer,
      interruptRequested: false,
      interruptTimer: null,
      pendingSteerAborts: 0,
      sessionReplacements: 0,
      releaseAfter: false,
    };
    const text = userMessage === null ? "" : contentText(userMessage.input);
    const nowSeconds = Math.floor(this.deps.nowMs() / 1000);
    this.thread.update((current) => ({
      ...current,
      turnCount: seq,
      updatedAt: nowSeconds,
      recencyAt: nowSeconds,
      firstUserMessage: current.firstUserMessage ?? (userMessage === null ? null : text),
      preview: current.preview.length > 0 || userMessage === null ? current.preview : text.slice(0, 200),
    }));
    const events = builder.begin(userMessage === null ? null : { clientMessageId: userMessage.clientMessageId, content: userMessage.input });
    this.thread.writeTurn({ version: 1, seq, turn: builder.snapshot(), prompts });
    this.emitAll(events);
    this.thread.emitThreadUpdated();
  }

  /** Explicit steer into the active turn. */
  steer(expectedTurnId: TurnId, clientMessageId: ClientMessageId | null, input: readonly UserContent[]): SteerOutcome {
    const active = this.active;
    if (active === null || active.builder.turnId !== expectedTurnId || active.interruptRequested || this.query === null) {
      return { status: "error", message: EXPECTED_TURN_NOT_ACTIVE };
    }
    const uuid = STEER_WITH_UUID ? this.deps.newUuid() : null;
    active.prompts.push({ uuid, clientMessageId });
    active.pendingSteerAborts += 1;
    this.emitAll(active.builder.addUserMessage(clientMessageId, input));
    this.query.offer({ uuid, priority: "now", content: promptContent(input) });
    return { status: "ok", turnId: active.builder.turnId };
  }

  /**
   * Answers at once in every state. Errors only for a foreign turn id while a
   * turn is active (`knownTurn` says whether the id is a past turn of this thread).
   */
  interrupt(turnId: TurnId | null, knownTurn: (turnId: TurnId) => boolean): InterruptOutcome {
    const active = this.active;
    if (active === null) return { status: "ok" };
    if (turnId !== null && turnId !== active.builder.turnId) {
      return knownTurn(turnId) ? { status: "ok" } : { status: "error", message: EXPECTED_TURN_NOT_ACTIVE };
    }
    if (active.interruptRequested) return { status: "ok" };
    active.interruptRequested = true;
    active.releaseAfter = active.builder.hasRunningCommand;
    const query = this.query;
    if (query === null) {
      this.finishTurn({ status: "interrupted" }, null);
      return { status: "ok" };
    }
    query.interrupt().catch((error: unknown) => {
      this.log("warn", "claude interrupt request failed", { err: error instanceof Error ? error : new Error(String(error)) });
    });
    active.interruptTimer = setTimeout(() => {
      if (this.active !== active) return;
      this.log("warn", "claude interrupt did not settle; closing the session");
      this.closeQuery();
      this.finishTurn({ status: "interrupted" }, null);
    }, this.deps.interruptTimeoutMs);
    return { status: "ok" };
  }

  // ------------------------------------------------------------- requests

  /** Delivers the user's answer to a pending runtime request. */
  respond(requestId: NativeRequestId, response: RuntimeResponse): boolean {
    const key = String(requestId);
    const request = this.pending.get(key);
    if (request === undefined) return false;
    this.pending.delete(key);
    this.deps.emit({ type: "request.resolved", appThreadId: this.thread.appThreadId, requestId: request.requestId, reason: "responded" });
    request.settle(response);
    return true;
  }

  private openRequest(requestId: string, request: RuntimeRequest, signal: AbortSignal): Promise<RuntimeResponse | null> {
    const active = this.active;
    if (active === null) return Promise.resolve(null);
    return new Promise((resolve) => {
      const onAbort = (): void => {
        if (!this.pending.has(requestId)) return;
        this.pending.delete(requestId);
        this.deps.emit({ type: "request.resolved", appThreadId: this.thread.appThreadId, requestId, reason: "cancelled" });
        resolve(null);
      };
      this.pending.set(requestId, {
        requestId,
        settle: (response) => {
          signal.removeEventListener("abort", onAbort);
          resolve(response);
        },
      });
      signal.addEventListener("abort", onAbort, { once: true });
      this.deps.emit({ type: "request.opened", appThreadId: this.thread.appThreadId, turnId: active.builder.turnId, requestId, request });
    });
  }

  private resolveAllPending(reason: "turnEnded" | "cancelled" | "providerRestarted"): void {
    for (const [key, request] of [...this.pending]) {
      this.pending.delete(key);
      this.deps.emit({ type: "request.resolved", appThreadId: this.thread.appThreadId, requestId: request.requestId, reason });
      request.settle(null);
    }
  }

  /** `canUseTool`: never returns null; any failure denies. */
  private async canUseTool(request: PermissionRequest): Promise<PermissionDecision> {
    try {
      return await this.decide(request);
    } catch (error) {
      this.log("error", "permission decision failed; denying", { err: error instanceof Error ? error : new Error(String(error)) });
      return cancelledDecision(request.toolUseId);
    }
  }

  private async decide(request: PermissionRequest): Promise<PermissionDecision> {
    if (this.active === null) this.beginTurn(asTurnId(this.deps.newUuid()), "provider", [], null, null);
    const active = this.active;
    if (active === null) return cancelledDecision(request.toolUseId);
    const record = this.thread.record();
    const profile = profileOptions(isProfileId(record.settings.permissionProfile) ? record.settings.permissionProfile : ":read-only");
    const disposition = toolDisposition(request.toolName);
    if (disposition.type === "exitPlan") {
      this.emitAll(active.builder.startTool(request.toolUseId, request.toolName, request.input));
      return { behavior: "deny", message: EXIT_PLAN_MESSAGE, interrupt: false, toolUseID: request.toolUseId };
    }
    if (disposition.type === "question") {
      const questions = userInputQuestions(request.input);
      const response = await this.openRequest(
        `perm-${request.toolUseId}`,
        { type: "userInput", itemId: asItemId(request.toolUseId), questions },
        request.signal,
      );
      return response === null ? cancelledDecision(request.toolUseId) : userInputDecision(response, request.input, questions, request.toolUseId);
    }
    if (!profileAllowsTool(profile, request.toolName)) {
      active.builder.markDeclined(request.toolUseId);
      return { behavior: "deny", message: readOnlyDenyMessage(request.toolName), interrupt: false, toolUseID: request.toolUseId };
    }
    this.emitAll(active.builder.startTool(request.toolUseId, request.toolName, request.input));
    const response = await this.openRequest(
      `perm-${request.toolUseId}`,
      approvalRequest(request.toolName, request.toolUseId, request.input, record.cwd, this.mcpServers, request.decisionReason),
      request.signal,
    );
    const decision = response === null ? cancelledDecision(request.toolUseId) : approvalDecision(response, request.input, request.suggestions, request.toolUseId);
    if (decision.behavior === "deny") active.builder.markDeclined(request.toolUseId);
    return decision;
  }

  // ---------------------------------------------------------------- query

  private ensureQuery(): ClaudeQuery {
    if (this.query !== null) return this.query;
    const record = this.thread.record();
    const profileId = record.settings.permissionProfile;
    const query = this.deps.runtime.open({
      identity: record.sessionStarted ? { type: "resume", sessionId: record.claudeSessionId } : { type: "new", sessionId: record.claudeSessionId },
      cwd: record.cwd,
      model: record.settings.model,
      effort: record.settings.effort,
      profile: profileOptions(isProfileId(profileId) ? profileId : ":read-only"),
      canUseTool: (request) => this.canUseTool(request),
    });
    this.query = query;
    this.deps.liveSessions.count += 1;
    this.log("info", "claude session opened", { liveSessions: this.deps.liveSessions.count, resumed: record.sessionStarted });
    const generation = ++this.generation;
    void this.readLoop(query, generation);
    return query;
  }

  private async readLoop(query: ClaudeQuery, generation: number): Promise<void> {
    try {
      for (;;) {
        const next = await query.next();
        if (generation !== this.generation) return;
        if (next.done === true) {
          this.onQueryEnded(null);
          return;
        }
        this.onMessage(next.value);
      }
    } catch (error) {
      if (generation === this.generation) this.onQueryEnded(error instanceof Error ? error : new Error(String(error)));
    }
  }

  /** Closes the current query and ignores its remaining output. */
  private closeQuery(): void {
    const query = this.query;
    if (query === null) return;
    this.query = null;
    this.generation += 1;
    query.close();
    this.deps.liveSessions.count -= 1;
    this.log("info", "claude session released", { liveSessions: this.deps.liveSessions.count });
  }

  private onQueryEnded(error: Error | null): void {
    this.query = null;
    this.generation += 1;
    this.deps.liveSessions.count -= 1;
    this.log(error === null ? "info" : "warn", "claude session ended", {
      liveSessions: this.deps.liveSessions.count,
      ...(error === null ? {} : { err: error }),
    });
    const active = this.active;
    if (active === null) {
      this.clearIdleTimer();
      this.thread.emitThreadUpdated();
      return;
    }
    if (active.interruptRequested) {
      this.finishTurn({ status: "interrupted" }, null);
      return;
    }
    this.finishTurn({ status: "failed", error: { kind: "processExited", message: PROCESS_EXITED_MESSAGE } }, null);
  }

  private onMessage(raw: unknown): void {
    const frame = classifyFrame(raw);
    switch (frame.kind) {
      case "init":
        this.mcpServers = frame.mcpServers;
        this.active?.builder.setMcpServers(frame.mcpServers);
        if (!this.thread.record().sessionStarted) this.thread.update((record) => ({ ...record, sessionStarted: true }));
        return;
      case "backgroundTasks":
        this.backgroundTasks = frame.count;
        if (frame.count === 0 && this.active === null) this.applyPendingSettingsIfPossible();
        return;
      case "rateLimit":
        this.log("info", "claude rate limit status", { status: frame.status });
        return;
      case "result":
        this.onResult(frame);
        return;
      case "other":
        return;
      default:
        this.onContent(frame);
    }
  }

  private onContent(frame: Exclude<ClaudeFrame, { kind: "init" | "backgroundTasks" | "rateLimit" | "result" | "other" }>): void {
    if ((frame.kind === "stream" || frame.kind === "assistant" || frame.kind === "user") && frame.parentToolUseId !== null) return;
    if (frame.kind === "user" && (frame.isSynthetic || frame.toolResults.length === 0)) return;
    if (frame.kind === "stream" && frame.event.type === "other") return;
    if (this.active === null) {
      this.clearIdleTimer();
      this.beginTurn(asTurnId(this.deps.newUuid()), "provider", [], null, null);
    }
    const active = this.active;
    if (active !== null) this.emitAll(active.builder.onFrame(frame));
  }

  private onResult(frame: Extract<ClaudeFrame, { kind: "result" }>): void {
    const active = this.active;
    if (active === null) return;
    if (isLostSession(frame)) {
      this.replaceLostSession(active);
      return;
    }
    if (!active.interruptRequested && isInterruption(frame) && active.pendingSteerAborts > 0) {
      active.pendingSteerAborts -= 1;
      return;
    }
    if (!active.interruptRequested && active.builder.origin === "user" && frame.origin !== null) {
      // A provider-initiated result (task notification, peer) inside a user
      // turn does not answer the user's prompt.
      return;
    }
    const outcome: TurnOutcome = active.interruptRequested && isInterruption(frame) ? { status: "interrupted" } : turnOutcome(frame, active.builder.assistantError);
    this.finishTurn(outcome, frame.usage === null ? null : { usage: usageOf(frame.usage), contextWindow: frame.contextWindow });
  }

  private replaceLostSession(active: ActiveTurn): void {
    if (active.sessionReplacements >= 1 || active.firstOffer === null) {
      this.closeQuery();
      this.finishTurn({ status: "failed", error: { kind: "sessionLost", message: "The Claude session for this thread was lost." } }, null);
      return;
    }
    active.sessionReplacements += 1;
    this.closeQuery();
    const sessionId = this.deps.newUuid();
    this.log("warn", "claude session was lost; starting a replacement session", { claudeSessionId: sessionId });
    this.thread.update((record) => ({ ...record, claudeSessionId: sessionId, sessionStarted: false }));
    const prefix = historyPrefix(this.thread.historyLines());
    const content: PromptContent[] = prefix === null ? [...active.firstOffer] : [{ type: "text", text: prefix }, ...active.firstOffer];
    const uuid = this.deps.newUuid();
    active.prompts.push({ uuid, clientMessageId: null });
    this.ensureQuery().offer({ uuid, priority: null, content });
  }

  private finishTurn(outcome: TurnOutcome, usage: { readonly usage: TokenUsage; readonly contextWindow: number | null } | null): void {
    const active = this.active;
    if (active === null) return;
    if (active.interruptTimer !== null) clearTimeout(active.interruptTimer);
    this.resolveAllPending(outcome.status === "interrupted" ? "cancelled" : "turnEnded");
    const record = this.thread.record();
    const total = usage === null ? record.totalUsage : addUsage(record.totalUsage, usage.usage);
    const { events, turn } = active.builder.finish(
      outcome,
      usage === null ? null : { last: usage.usage, total, contextWindow: usage.contextWindow },
    );
    this.active = null;
    this.thread.writeTurn({ version: 1, seq: active.seq, turn, prompts: active.prompts });
    const nowSeconds = Math.floor(this.deps.nowMs() / 1000);
    this.thread.update((current) => ({ ...current, totalUsage: total, updatedAt: nowSeconds }));
    this.emitAll(events);
    this.thread.emitThreadUpdated();
    if (active.releaseAfter) this.closeQuery();
    this.applyPendingSettingsIfPossible();
    this.armIdleTimer();
  }

  // ------------------------------------------------------------- settings

  /** Stores new settings; they take effect at the next turn boundary. Returns whether anything changed. */
  updateSettings(next: ThreadSettings): boolean {
    const record = this.thread.record();
    const effective = record.pendingSettings ?? record.settings;
    if (JSON.stringify(effective) === JSON.stringify(next)) return false;
    this.thread.update((current) => ({ ...current, pendingSettings: next }));
    this.applyPendingSettingsIfPossible();
    return true;
  }

  private applyPendingSettingsIfPossible(): void {
    const record = this.thread.record();
    if (record.pendingSettings === null || this.active !== null || this.backgroundTasks > 0) return;
    const pending = record.pendingSettings;
    // The idle query keeps the old options; close it so the next turn reopens with `resume`.
    this.closeQuery();
    this.thread.update((current) => ({ ...current, settings: pending, pendingSettings: null }));
    this.thread.emitThreadUpdated();
  }

  // ----------------------------------------------------------------- idle

  private clearIdleTimer(): void {
    if (this.idleTimer !== null) clearTimeout(this.idleTimer);
    this.idleTimer = null;
    this.idleSinceMs = null;
  }

  private armIdleTimer(): void {
    if (this.disposed || this.query === null) return;
    if (this.idleTimer !== null) clearTimeout(this.idleTimer);
    this.idleSinceMs ??= this.deps.nowMs();
    this.idleTimer = setTimeout(() => this.onIdleTimer(), this.deps.idleReleaseMs);
  }

  private onIdleTimer(): void {
    this.idleTimer = null;
    if (this.active !== null || this.pending.size > 0 || this.query === null) return;
    const idleFor = this.deps.nowMs() - (this.idleSinceMs ?? this.deps.nowMs());
    if (this.backgroundTasks > 0 && idleFor < this.deps.backgroundDeferMaxMs) {
      this.idleTimer = setTimeout(() => this.onIdleTimer(), this.deps.idleReleaseMs);
      return;
    }
    this.idleSinceMs = null;
    this.closeQuery();
    this.thread.emitThreadUpdated();
  }

  /** Ends the session for good (thread deleted or sidecar shutdown). */
  dispose(): void {
    this.disposed = true;
    this.clearIdleTimer();
    if (this.active !== null) {
      this.active.interruptRequested = true;
      this.closeQuery();
      this.finishTurn({ status: "interrupted" }, null);
    }
    this.closeQuery();
  }
}
