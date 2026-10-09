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
 * - A user turn's id is the uuid of its first prompt offer, which Claude
 *   persists, so the turn keeps its id when history is read back.
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
 * - The turn index entry is written when a turn starts, on a steer and when
 *   it ends; the in-flight snapshot whenever an item starts or completes.
 * - Client tools are allowed without a prompt under every profile (the
 *   companion enforces their limits); a changed tool set applies when the
 *   query (re)opens, so an idle query without background tasks is closed;
 *   in-flight client tool calls are cancelled when their turn ends.
 */

import type {
  AgentEvent,
  AgentTurn,
  AppThreadId,
  ClientMessageId,
  ClientToolSpec,
  NativeRequestId,
  RuntimeRequest,
  RuntimeResponse,
  ThreadSettings,
  TokenUsage,
  TurnId,
  TurnOrigin,
  TurnStartResult,
  TurnUsageRecord,
  UserContent,
} from "../protocol.js";
import { asItemId, asTurnId, EXPECTED_TURN_NOT_ACTIVE } from "../protocol.js";
import type {
  ClaudeQuery,
  ClaudeRuntime,
  PermissionRequest,
  PromptContent,
} from "../claude/port.js";
import type { Logger, LogField } from "../log.js";
import { classifyFrame, type ClaudeFrame } from "../mapping/frames.js";
import {
  isInterruption,
  isLostSession,
  PROCESS_EXITED_MESSAGE,
  turnOutcome,
  type TurnOutcome,
} from "../mapping/result.js";
import { toolDisposition } from "../mapping/tools.js";
import {
  addDelta,
  addUsage,
  meterResult,
  NEW_SESSION_BASELINE,
  providerCost,
  requestUsage,
  threadCostAfter,
  ZERO_USAGE,
  type UsageDelta,
} from "../mapping/usage.js";
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
import {
  isProfileId,
  profileAllowsTool,
  profileOptions,
  type ProfileOptions,
} from "../permissions/profiles.js";
import { historyPrefix } from "../history/prefix.js";
import {
  currentSessionId,
  withTurnRecord,
  type PromptRecord,
  type ThreadState,
  type TurnOutcomeRecord,
} from "../state/threadState.js";
import { ClientToolCalls, type ClientToolCaller } from "./clientToolCalls.js";
import { promptContent } from "./prompt.js";
import { TurnBuilder } from "./turnBuilder.js";
import { unreachable } from "../support/unreachable.js";

/** E-STEER-UUID switch: offer steers with a fresh uuid (canvas default) or without (fallback). */
export const STEER_WITH_UUID: boolean = true;

const MS_PER_SECOND = 1000;
const seconds = (ms: number): number => Math.floor(ms / MS_PER_SECOND);

/** What a session needs from its thread owner. */
export interface ThreadPort {
  readonly appThreadId: AppThreadId;
  /** Emits `thread.updated` with the current projection. */
  readonly emitThreadUpdated: () => void;
  /** User messages and final answers of the thread's stored history, oldest first. */
  readonly historyLines: () => Promise<readonly string[]>;
  /** Called once Claude has created the current session (its `init` frame arrived). */
  readonly sessionReady: () => void;
  readonly state: () => ThreadState;
  /** Applies and persists a metadata change. */
  readonly update: (change: (state: ThreadState) => ThreadState) => void;
  /** Persists the in-flight turn snapshot, or removes it with `null`. */
  readonly writeActiveTurn: (turn: AgentTurn | null) => void;
}

export interface SessionDeps {
  readonly backgroundDeferMaxMs: number;
  /** Sends a client tool call to the companion (`tool.call`). */
  readonly callClientTool: ClientToolCaller;
  readonly emit: (event: AgentEvent) => void;
  readonly idleReleaseMs: number;
  readonly interruptTimeoutMs: number;
  /** Shared live-process counter, logged on every open and release. */
  readonly liveSessions: { count: number };
  readonly logger: Logger;
  readonly newUuid: () => string;
  readonly nowMs: () => number;
  readonly runtime: ClaudeRuntime;
}

interface PendingRequest {
  readonly requestId: NativeRequestId;
  readonly settle: (response: RuntimeResponse | null) => void;
}

interface ActiveTurn {
  /** Persisted message uuids identifying the turn in Claude's store. */
  readonly anchors: string[];
  readonly builder: TurnBuilder;
  /** The first offer, kept to resend after a lost session. */
  readonly firstOffer: readonly PromptContent[] | null;
  /** Whether the first persisted frame's uuid is among the anchors. */
  frameAnchored: boolean;
  interruptRequested: boolean;
  interruptTimer: NodeJS.Timeout | null;
  /** The context size of the turn's latest top-level model request. */
  lastRequest: TokenUsage | null;
  /** Steers whose `aborted_*` restart result must not end the turn. */
  pendingSteerAborts: number;
  readonly prompts: PromptRecord[];
  /** E-INT-TOOL fallback: release the process after this turn. */
  releaseAfter: boolean;
  sessionReplacements: number;
  /** Usage measured from this turn's results so far; `null` before the first. */
  usage: UsageDelta | null;
}

export type SteerOutcome =
  | { readonly message: string; readonly status: "error" }
  | { readonly status: "ok"; readonly turnId: TurnId };

export type InterruptOutcome =
  | { readonly message: string; readonly status: "error" }
  | { readonly status: "ok" };

/** A user turn or the `/compact` turn. */
export type TurnRequest =
  | {
      readonly clientMessageId: ClientMessageId | null;
      readonly input: readonly UserContent[];
      readonly kind: "user";
    }
  | { readonly kind: "compact" };

interface TurnStart {
  readonly firstOffer: readonly PromptContent[] | null;
  readonly origin: TurnOrigin;
  readonly prompts: PromptRecord[];
  readonly turnId: TurnId;
  readonly userMessage: {
    readonly clientMessageId: ClientMessageId | null;
    readonly content: readonly UserContent[];
  } | null;
}

const toError = (error: unknown): Error =>
  error instanceof Error ? error : new Error(String(error));

const outcomeRecord = (outcome: TurnOutcome): TurnOutcomeRecord => outcome;

/** Frames that carry conversation content. */
type ContentFrame = Extract<
  ClaudeFrame,
  { readonly kind: "assistant" | "compactBoundary" | "stream" | "user" }
>;

/** Uuid Claude persists a frame under, when the frame is one it persists. */
function persistedUuid(frame: ContentFrame): string | null {
  return frame.kind === "stream" ? null : frame.uuid;
}

/** Whether a content frame belongs to the top-level conversation. */
function isTopLevelContent(frame: ContentFrame): boolean {
  switch (frame.kind) {
    case "stream":
      return frame.parentToolUseId === null && frame.event.type !== "other";
    case "assistant":
      return frame.parentToolUseId === null;
    case "user":
      return frame.parentToolUseId === null && !frame.isSynthetic && frame.toolResults.length > 0;
    case "compactBoundary":
      return true;
    default:
      return unreachable(frame);
  }
}

type ResultFrame = Extract<ClaudeFrame, { readonly kind: "result" }>;

const profileOf = (settings: ThreadSettings): ProfileOptions =>
  profileOptions(
    isProfileId(settings.permissionProfile) ? settings.permissionProfile : ":read-only",
  );

export class ClaudeSession {
  private query: ClaudeQuery | null = null;
  private generation = 0;
  private active: ActiveTurn | null = null;
  private readonly pending = new Map<string, PendingRequest>();
  private backgroundTasks = 0;
  /** The context size of the session's latest top-level model request, across turns. */
  private lastRequest: TokenUsage | null = null;
  private mcpServers: readonly string[] = [];
  private idleTimer: NodeJS.Timeout | null = null;
  private idleSinceMs: number | null = null;
  private disposed = false;
  private readonly thread: ThreadPort;
  private readonly deps: SessionDeps;
  private readonly clientTools: ClientToolCalls;
  /** The client tool set the open query was opened with. */
  private queryClientTools: readonly ClientToolSpec[] = [];

  public constructor(thread: ThreadPort, deps: SessionDeps) {
    this.thread = thread;
    this.deps = deps;
    this.clientTools = new ClientToolCalls({
      appThreadId: thread.appThreadId,
      call: deps.callClientTool,
      logger: deps.logger,
      newUuid: deps.newUuid,
      turn: () => {
        const active = this.active;
        return active === null
          ? null
          : {
              openToolCalls: (toolName) => active.builder.openToolCalls(toolName),
              turnId: active.builder.turnId,
            };
      },
    });
  }

  public get activeTurnId(): TurnId | null {
    return this.active?.builder.turnId ?? null;
  }

  public get isLive(): boolean {
    return this.query !== null;
  }

  /** The in-progress turn, for `thread.turns`. */
  public activeSnapshot(): AgentTurn | null {
    return this.active?.builder.snapshot() ?? null;
  }

  /**
   * Emits events in order. When an item started or completed, the in-flight
   * snapshot is persisted first, so a host restart can finalize the turn
   * with every item the client has already seen.
   */
  private emitAll(events: readonly AgentEvent[]): void {
    const active = this.active;
    if (
      active !== null &&
      events.some((event) => event.type === "item.started" || event.type === "item.completed")
    ) {
      this.thread.writeActiveTurn(active.builder.snapshot());
    }
    for (const event of events) {
      this.deps.emit(event);
    }
  }

  private log(
    level: "debug" | "info" | "warn" | "error",
    msg: string,
    fields: Readonly<Record<string, LogField>> = {},
  ): void {
    this.deps.logger.log(level, msg, { appThreadId: this.thread.appThreadId, ...fields });
  }

  // ---------------------------------------------------------------- turns

  /** Starts a user turn (or the `/compact` turn). Never steers. */
  public startTurn(request: TurnRequest): TurnStartResult {
    if (this.active !== null) {
      return { activeTurnId: this.active.builder.turnId, type: "busy" };
    }
    this.clearIdleTimer();
    this.applyPendingSettingsIfPossible();
    this.reopenForClientTools();
    const offerUuid = this.deps.newUuid();
    const turnId = asTurnId(offerUuid);
    const user = request.kind === "user" ? request : null;
    const firstOffer: readonly PromptContent[] =
      user === null ? [{ text: "/compact", type: "text" }] : promptContent(user.input);
    this.beginTurn({
      firstOffer,
      origin: user === null ? "provider" : "user",
      prompts: [{ clientMessageId: user?.clientMessageId ?? null, role: "first", uuid: offerUuid }],
      turnId,
      userMessage:
        user === null ? null : { clientMessageId: user.clientMessageId, content: user.input },
    });
    this.ensureQuery().offer({ content: firstOffer, priority: null, uuid: offerUuid });
    return { turnId, type: "started" };
  }

  private beginTurn(start: TurnStart): void {
    const state = this.thread.state();
    const builder = new TurnBuilder({
      appThreadId: this.thread.appThreadId,
      cwd: state.cwd,
      nowMs: this.deps.nowMs,
      origin: start.origin,
      turnId: start.turnId,
    });
    builder.setMcpServers(this.mcpServers);
    this.active = {
      anchors: start.prompts.flatMap((prompt) => (prompt.uuid === null ? [] : [prompt.uuid])),
      builder,
      firstOffer: start.firstOffer,
      frameAnchored: false,
      interruptRequested: false,
      interruptTimer: null,
      lastRequest: null,
      pendingSteerAborts: 0,
      prompts: start.prompts,
      releaseAfter: false,
      sessionReplacements: 0,
      usage: null,
    };
    const nowSeconds = seconds(this.deps.nowMs());
    this.thread.update((current) => ({
      ...current,
      recencyAt: start.userMessage === null ? current.recencyAt : nowSeconds,
      updatedAt: nowSeconds,
    }));
    this.recordActiveTurn({ status: "inProgress" });
    const events = builder.begin(start.userMessage);
    this.thread.writeActiveTurn(builder.snapshot());
    this.emitAll(events);
    this.thread.emitThreadUpdated();
  }

  /** Writes the active turn's index entry with `outcome` and, when it ended, its usage. */
  private recordActiveTurn(outcome: TurnOutcomeRecord, usage: TurnUsageRecord | null = null): void {
    const active = this.active;
    if (active === null) {
      return;
    }
    const finished = outcome.status !== "inProgress";
    this.thread.update((state) =>
      withTurnRecord(state, {
        anchors: [...active.anchors],
        completedAt: finished ? seconds(this.deps.nowMs()) : null,
        origin: active.builder.origin,
        outcome,
        prompts: [...active.prompts],
        startedAt: active.builder.startedAt,
        turnId: active.builder.turnId,
        usage,
      }),
    );
  }

  /** Explicit steer into the active turn. */
  public steer(
    expectedTurnId: TurnId,
    message: {
      readonly clientMessageId: ClientMessageId | null;
      readonly input: readonly UserContent[];
    },
  ): SteerOutcome {
    const active = this.active;
    const query = this.query;
    if (
      active === null ||
      active.builder.turnId !== expectedTurnId ||
      active.interruptRequested ||
      query === null
    ) {
      return { message: EXPECTED_TURN_NOT_ACTIVE, status: "error" };
    }
    const uuid = STEER_WITH_UUID ? this.deps.newUuid() : null;
    active.prompts.push({ clientMessageId: message.clientMessageId, role: "steer", uuid });
    if (uuid !== null) {
      active.anchors.push(uuid);
    }
    active.pendingSteerAborts += 1;
    this.recordActiveTurn({ status: "inProgress" });
    this.emitAll(active.builder.addUserMessage(message.clientMessageId, message.input));
    query.offer({ content: promptContent(message.input), priority: "now", uuid });
    return { status: "ok", turnId: active.builder.turnId };
  }

  /**
   * Answers at once in every state. Errors only for a foreign turn id while a
   * turn is active (`knownTurn` says whether the id is a past turn of this thread).
   */
  public interrupt(turnId: TurnId | null, knownTurn: boolean): InterruptOutcome {
    const active = this.active;
    if (active === null) {
      return { status: "ok" };
    }
    if (turnId !== null && turnId !== active.builder.turnId) {
      return knownTurn ? { status: "ok" } : { message: EXPECTED_TURN_NOT_ACTIVE, status: "error" };
    }
    if (!active.interruptRequested) {
      this.requestInterrupt(active);
    }
    return { status: "ok" };
  }

  private requestInterrupt(active: ActiveTurn): void {
    active.interruptRequested = true;
    this.clientTools.cancelAll();
    active.releaseAfter = active.builder.hasRunningCommand;
    const query = this.query;
    if (query === null) {
      this.finishTurn({ status: "interrupted" });
      return;
    }
    query.interrupt().catch((error: unknown) => {
      this.log("warn", "claude interrupt request failed", { err: toError(error) });
    });
    active.interruptTimer = setTimeout(() => {
      if (this.active !== active) {
        return;
      }
      this.log("warn", "claude interrupt did not settle; closing the session");
      this.closeQuery();
      this.finishTurn({ status: "interrupted" });
    }, this.deps.interruptTimeoutMs);
  }

  /** Whether `turnId` names the active turn or a turn in the host's index. */
  public isIndexedTurn(turnId: TurnId): boolean {
    return this.thread.state().turns.some((turn) => turn.turnId === turnId);
  }

  // ------------------------------------------------------------- requests

  /** Delivers the user's answer to a pending runtime request. */
  public respond(requestId: NativeRequestId, response: RuntimeResponse): boolean {
    const key = String(requestId);
    const request = this.pending.get(key);
    if (request === undefined) {
      return false;
    }
    this.pending.delete(key);
    this.deps.emit({
      appThreadId: this.thread.appThreadId,
      reason: "responded",
      requestId: request.requestId,
      type: "request.resolved",
    });
    request.settle(response);
    return true;
  }

  private async openRequest(
    requestId: string,
    request: RuntimeRequest,
    signal: AbortSignal,
  ): Promise<RuntimeResponse | null> {
    const active = this.active;
    if (active === null) {
      return null;
    }
    return new Promise((resolve) => {
      const onAbort = (): void => {
        if (!this.pending.has(requestId)) {
          return;
        }
        this.pending.delete(requestId);
        this.deps.emit({
          appThreadId: this.thread.appThreadId,
          reason: "cancelled",
          requestId,
          type: "request.resolved",
        });
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
      this.deps.emit({
        appThreadId: this.thread.appThreadId,
        request,
        requestId,
        turnId: active.builder.turnId,
        type: "request.opened",
      });
    });
  }

  private resolveAllPending(reason: "turnEnded" | "cancelled" | "providerRestarted"): void {
    for (const [key, request] of this.pending) {
      this.pending.delete(key);
      this.deps.emit({
        appThreadId: this.thread.appThreadId,
        reason,
        requestId: request.requestId,
        type: "request.resolved",
      });
      request.settle(null);
    }
  }

  /** `canUseTool`: never returns null; any failure denies. */
  private async canUseTool(request: PermissionRequest): Promise<PermissionDecision> {
    try {
      return await this.decide(request);
    } catch (error) {
      this.log("error", "permission decision failed; denying", { err: toError(error) });
      return cancelledDecision(request.toolUseId);
    }
  }

  private activeOrWake(): ActiveTurn | null {
    if (this.active === null) {
      this.beginProviderTurn();
    }
    return this.active;
  }

  private beginProviderTurn(): void {
    this.clearIdleTimer();
    this.beginTurn({
      firstOffer: null,
      origin: "provider",
      prompts: [],
      turnId: asTurnId(this.deps.newUuid()),
      userMessage: null,
    });
  }

  private async decide(request: PermissionRequest): Promise<PermissionDecision> {
    const active = this.activeOrWake();
    if (active === null) {
      return cancelledDecision(request.toolUseId);
    }
    if (this.clientTools.owns(request.toolName)) {
      this.emitAll(active.builder.startTool(request.toolUseId, request.toolName, request.input));
      return {
        behavior: "allow",
        scope: "once",
        toolUseID: request.toolUseId,
        updatedInput: request.input,
      };
    }
    const disposition = toolDisposition(request.toolName);
    if (disposition.type === "exitPlan") {
      this.emitAll(active.builder.startTool(request.toolUseId, request.toolName, request.input));
      return {
        behavior: "deny",
        interrupt: false,
        message: EXIT_PLAN_MESSAGE,
        toolUseID: request.toolUseId,
      };
    }
    if (disposition.type === "question") {
      return this.askQuestion(request);
    }
    return this.askApproval(active, request);
  }

  private async askQuestion(request: PermissionRequest): Promise<PermissionDecision> {
    const questions = userInputQuestions(request.input);
    const response = await this.openRequest(
      `perm-${request.toolUseId}`,
      { itemId: asItemId(request.toolUseId), questions, type: "userInput" },
      request.signal,
    );
    return response === null
      ? cancelledDecision(request.toolUseId)
      : userInputDecision(response, {
          input: request.input,
          questions,
          toolUseId: request.toolUseId,
        });
  }

  private async askApproval(
    active: ActiveTurn,
    request: PermissionRequest,
  ): Promise<PermissionDecision> {
    const state = this.thread.state();
    if (!profileAllowsTool(profileOf(state.settings), request.toolName)) {
      active.builder.markDeclined(request.toolUseId);
      return {
        behavior: "deny",
        interrupt: false,
        message: readOnlyDenyMessage(request.toolName),
        toolUseID: request.toolUseId,
      };
    }
    this.emitAll(active.builder.startTool(request.toolUseId, request.toolName, request.input));
    const response = await this.openRequest(
      `perm-${request.toolUseId}`,
      approvalRequest({
        cwd: state.cwd,
        detail: request.decisionReason,
        input: request.input,
        mcpServers: this.mcpServers,
        toolName: request.toolName,
        toolUseId: request.toolUseId,
      }),
      request.signal,
    );
    const decision =
      response === null
        ? cancelledDecision(request.toolUseId)
        : approvalDecision(response, { input: request.input, toolUseId: request.toolUseId });
    if (decision.behavior === "deny") {
      active.builder.markDeclined(request.toolUseId);
    }
    return decision;
  }

  // ---------------------------------------------------------------- query

  private ensureQuery(): ClaudeQuery {
    if (this.query !== null) {
      return this.query;
    }
    const state = this.thread.state();
    const sessionId = currentSessionId(state);
    const query = this.deps.runtime.open({
      canUseTool: async (request) => this.canUseTool(request),
      clientTools: this.clientTools.binding(),
      cwd: state.cwd,
      effort: state.settings.effort,
      identity: state.sessionStarted ? { sessionId, type: "resume" } : { sessionId, type: "new" },
      model: state.settings.model,
      profile: profileOf(state.settings),
    });
    this.query = query;
    this.queryClientTools = this.clientTools.current;
    this.deps.liveSessions.count += 1;
    this.log("info", "claude session opened", {
      liveSessions: this.deps.liveSessions.count,
      resumed: state.sessionStarted,
    });
    this.generation += 1;
    this.readLoop(query, this.generation).catch((error: unknown) => {
      this.log("error", "claude session read loop failed", { err: toError(error) });
    });
    return query;
  }

  private async readLoop(query: ClaudeQuery, generation: number): Promise<void> {
    try {
      for (;;) {
        const next = await query.next();
        if (generation !== this.generation) {
          return;
        }
        if (next.done === true) {
          this.onQueryEnded(null);
          return;
        }
        this.onMessage(next.value);
      }
    } catch (error) {
      if (generation === this.generation) {
        this.onQueryEnded(toError(error));
      }
    }
  }

  /** Closes the current query and ignores its remaining output. */
  private closeQuery(): void {
    const query = this.query;
    if (query === null) {
      return;
    }
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
    this.finishTurn(
      active.interruptRequested
        ? { status: "interrupted" }
        : { error: { kind: "processExited", message: PROCESS_EXITED_MESSAGE }, status: "failed" },
    );
  }

  private onMessage(raw: unknown): void {
    const frame = classifyFrame(raw);
    switch (frame.kind) {
      case "init":
        this.onInit(frame.mcpServers);
        return;
      case "backgroundTasks":
        this.backgroundTasks = frame.count;
        if (frame.count === 0 && this.active === null) {
          this.applyPendingSettingsIfPossible();
        }
        return;
      case "rateLimit":
        this.log("info", "claude rate limit status", { status: frame.status });
        return;
      case "result":
        this.onResult(frame);
        return;
      case "other":
        return;
      case "assistant":
      case "compactBoundary":
      case "stream":
      case "user":
        this.onContent(frame);
        return;
      default:
        unreachable(frame);
    }
  }

  private onInit(mcpServers: readonly string[]): void {
    this.mcpServers = mcpServers;
    this.active?.builder.setMcpServers(mcpServers);
    if (!this.thread.state().sessionStarted) {
      this.thread.update((state) => ({ ...state, sessionStarted: true }));
    }
    this.thread.sessionReady();
  }

  private onContent(frame: ContentFrame): void {
    if (!isTopLevelContent(frame)) {
      return;
    }
    const active = this.activeOrWake();
    if (active === null) {
      return;
    }
    const uuid = persistedUuid(frame);
    if (uuid !== null && !active.frameAnchored) {
      active.frameAnchored = true;
      active.anchors.push(uuid);
    }
    this.observeRequest(active, frame);
    this.emitAll(active.builder.onFrame(frame));
  }

  /**
   * Tracks the context size of the latest top-level model request: the
   * `last` usage that context fill is computed from. A compaction makes the
   * earlier size meaningless until the next request.
   */
  private observeRequest(active: ActiveTurn, frame: ContentFrame): void {
    if (frame.kind === "assistant" && frame.usage !== null) {
      active.lastRequest = requestUsage(frame.usage);
      this.lastRequest = active.lastRequest;
    } else if (frame.kind === "compactBoundary") {
      active.lastRequest = null;
      this.lastRequest = null;
    }
  }

  /**
   * Adds the usage a result measures (against the session's persisted
   * totals) to the active turn, including results that do not end it.
   */
  private meterResult(active: ActiveTurn, frame: ResultFrame): void {
    const { baseline, delta } = meterResult(this.thread.state().usageBaseline, {
      mainLoop: frame.mainLoopUsage,
      totals: frame.modelUsage,
    });
    if (delta === null) {
      return;
    }
    active.usage = addDelta(active.usage, delta);
    this.thread.update((state) => ({ ...state, usageBaseline: baseline }));
  }

  /**
   * A result that does not end the active turn: the `aborted_*` restart a
   * steer causes, or a provider-initiated result (task notification, peer)
   * inside a user turn, which does not answer the user's prompt.
   */
  private static isIntermediateResult(active: ActiveTurn, frame: ResultFrame): boolean {
    if (active.interruptRequested) {
      return false;
    }
    if (isInterruption(frame) && active.pendingSteerAborts > 0) {
      active.pendingSteerAborts -= 1;
      return true;
    }
    return active.builder.origin === "user" && frame.origin !== null;
  }

  private onResult(frame: ResultFrame): void {
    const active = this.active;
    if (active === null) {
      // Not measured: the baseline stays, so the next turn's first result counts it.
      return;
    }
    this.meterResult(active, frame);
    if (isLostSession(frame)) {
      this.replaceLostSession(active);
      return;
    }
    if (ClaudeSession.isIntermediateResult(active, frame)) {
      return;
    }
    const outcome: TurnOutcome =
      active.interruptRequested && isInterruption(frame)
        ? { status: "interrupted" }
        : turnOutcome(frame, active.builder.assistantError);
    this.finishTurn(outcome);
  }

  private replaceLostSession(active: ActiveTurn): void {
    const firstOffer = active.firstOffer;
    if (active.sessionReplacements >= 1 || firstOffer === null) {
      this.closeQuery();
      this.finishTurn({
        error: { kind: "sessionLost", message: "The Claude session for this thread was lost." },
        status: "failed",
      });
      return;
    }
    active.sessionReplacements += 1;
    this.closeQuery();
    const sessionId = this.deps.newUuid();
    this.log("warn", "claude session was lost; starting a replacement session", {
      claudeSessionId: sessionId,
    });
    this.thread.update((state) => ({
      ...state,
      sessionIds: [...state.sessionIds, sessionId],
      sessionStarted: false,
      usageBaseline: NEW_SESSION_BASELINE,
    }));
    this.thread
      .historyLines()
      .catch((error: unknown) => {
        this.log("warn", "thread history for the replacement session is unavailable", {
          err: toError(error),
        });
        return [];
      })
      .then((lines) => {
        this.offerReplacement(active, { firstOffer, lines });
      })
      .catch((error: unknown) => {
        this.log("error", "replacement session offer failed", { err: toError(error) });
      });
  }

  private offerReplacement(
    active: ActiveTurn,
    replacement: {
      readonly firstOffer: readonly PromptContent[];
      readonly lines: readonly string[];
    },
  ): void {
    if (this.active !== active || this.disposed) {
      return;
    }
    const prefix = historyPrefix(replacement.lines);
    const content: readonly PromptContent[] =
      prefix === null
        ? replacement.firstOffer
        : [{ text: prefix, type: "text" }, ...replacement.firstOffer];
    const uuid = this.deps.newUuid();
    active.prompts.push({ clientMessageId: null, role: "resend", uuid });
    active.anchors.push(uuid);
    this.recordActiveTurn({ status: "inProgress" });
    this.ensureQuery().offer({ content, priority: null, uuid });
  }

  /**
   * The usage a finished turn reports (its measured usage, the thread totals
   * after it and the context size of its last request) and the thread's
   * totals after it. The record is `null` when no result measured anything;
   * the next turn then counts it.
   */
  private turnUsage(active: ActiveTurn): {
    readonly record: TurnUsageRecord | null;
    readonly totals: Pick<ThreadState, "totalCost" | "totalUsage">;
  } {
    const state = this.thread.state();
    const measured = active.usage;
    if (measured === null) {
      return { record: null, totals: { totalCost: state.totalCost, totalUsage: state.totalUsage } };
    }
    const totalCost = threadCostAfter(state.totalCost, measured.cost);
    const cost = providerCost(measured.cost, totalCost);
    const total = addUsage(state.totalUsage, measured.usage);
    return {
      record: {
        contextWindow: measured.contextWindow,
        ...(cost === null ? {} : { cost }),
        last: active.lastRequest ?? this.lastRequest ?? ZERO_USAGE,
        total,
        turn: measured.usage,
      },
      totals: { totalCost, totalUsage: total },
    };
  }

  private finishTurn(outcome: TurnOutcome): void {
    const active = this.active;
    if (active === null) {
      return;
    }
    if (active.interruptTimer !== null) {
      clearTimeout(active.interruptTimer);
    }
    this.clientTools.cancelAll();
    this.resolveAllPending(outcome.status === "interrupted" ? "cancelled" : "turnEnded");
    const usage = this.turnUsage(active);
    const { events } = active.builder.finish(outcome, usage.record);
    this.recordActiveTurn(outcomeRecord(outcome), usage.record);
    this.active = null;
    const nowSeconds = seconds(this.deps.nowMs());
    this.thread.update((current) => ({ ...current, ...usage.totals, updatedAt: nowSeconds }));
    this.thread.writeActiveTurn(null);
    this.emitAll(events);
    this.thread.emitThreadUpdated();
    if (active.releaseAfter) {
      this.closeQuery();
    }
    this.applyPendingSettingsIfPossible();
    this.armIdleTimer();
  }

  // ------------------------------------------------------------- settings

  /** Stores new settings; they take effect at the next turn boundary. Returns whether anything changed. */
  public updateSettings(next: ThreadSettings): boolean {
    const state = this.thread.state();
    const effective = state.pendingSettings ?? state.settings;
    if (JSON.stringify(effective) === JSON.stringify(next)) {
      return false;
    }
    this.thread.update((current) => ({ ...current, pendingSettings: next }));
    this.applyPendingSettingsIfPossible();
    return true;
  }

  private applyPendingSettingsIfPossible(): void {
    const pending = this.thread.state().pendingSettings;
    if (pending === null || this.active !== null || this.backgroundTasks > 0) {
      return;
    }
    // The idle query keeps the old options; close it so the next turn reopens with `resume`.
    this.closeQuery();
    this.thread.update((current) => ({ ...current, pendingSettings: null, settings: pending }));
    this.thread.emitThreadUpdated();
  }

  /** Replaces the thread's client tools; they apply when a turn next opens or reopens the query. */
  public useClientTools(tools: readonly ClientToolSpec[]): void {
    this.clientTools.replace(tools);
  }

  /**
   * Before a user turn: the open query keeps the tools it was opened with,
   * so an idle query with an outdated set is closed and the turn reopens it
   * with `resume`. With background tasks running it is kept (closing would
   * end them) and the new set applies when it next opens.
   */
  private reopenForClientTools(): void {
    if (this.query === null || this.queryClientTools === this.clientTools.current) {
      return;
    }
    if (this.backgroundTasks > 0) {
      this.log("info", "client tools change waits for background tasks", {
        backgroundTasks: this.backgroundTasks,
      });
      return;
    }
    this.closeQuery();
  }

  // ----------------------------------------------------------------- idle

  private clearIdleTimer(): void {
    if (this.idleTimer !== null) {
      clearTimeout(this.idleTimer);
    }
    this.idleTimer = null;
    this.idleSinceMs = null;
  }

  private armIdleTimer(): void {
    if (this.disposed || this.query === null) {
      return;
    }
    if (this.idleTimer !== null) {
      clearTimeout(this.idleTimer);
    }
    this.idleSinceMs ??= this.deps.nowMs();
    this.idleTimer = setTimeout(() => {
      this.onIdleTimer();
    }, this.deps.idleReleaseMs);
  }

  private onIdleTimer(): void {
    this.idleTimer = null;
    if (this.active !== null || this.pending.size > 0 || this.query === null) {
      return;
    }
    const idleFor = this.deps.nowMs() - (this.idleSinceMs ?? this.deps.nowMs());
    if (this.backgroundTasks > 0 && idleFor < this.deps.backgroundDeferMaxMs) {
      this.idleTimer = setTimeout(() => {
        this.onIdleTimer();
      }, this.deps.idleReleaseMs);
      return;
    }
    this.idleSinceMs = null;
    this.closeQuery();
    this.thread.emitThreadUpdated();
  }

  /** Ends the session for good (thread deleted or host shutdown). */
  public dispose(): void {
    this.disposed = true;
    this.clearIdleTimer();
    if (this.active !== null) {
      this.active.interruptRequested = true;
      this.closeQuery();
      this.finishTurn({ status: "interrupted" });
    }
    this.closeQuery();
  }
}
