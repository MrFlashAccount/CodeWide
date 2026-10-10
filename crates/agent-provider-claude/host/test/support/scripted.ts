/**
 * A hand-driven fake runtime for session unit tests: each opened query
 * exposes `push(frame)`, `end()` and `fail(error)` and records offers,
 * interrupts and closes.
 */

import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type {
  AgentEvent,
  ProviderRateLimits,
  ToolCallParams,
  ToolCallResult,
  TurnId,
  UserContent,
} from "../../src/protocol.js";
import type {
  ClaudeQuery,
  ClaudeRuntime,
  PromptOffer,
  QueryOpenOptions,
} from "../../src/claude/port.js";
import { RateLimitReporter } from "../../src/account/rateLimitReporter.js";
import { createMemoryLogger } from "../../src/log.js";
import { ThreadStateStore } from "../../src/state/stateStore.js";
import { ThreadService, type OperationResult } from "../../src/threads/service.js";
import { SessionCatalog } from "../../src/threads/sessionCatalog.js";
import { MemorySessionStore } from "./memoryStore.js";
import { counterUuids } from "./replay.js";

export interface ScriptedQuery {
  readonly options: QueryOpenOptions;
  readonly offers: PromptOffer[];
  interrupts: number;
  closed: boolean;
  readonly push: (frame: unknown) => void;
  readonly end: () => void;
  readonly fail: (error: Error) => void;
  /** Every live permission mode change, in order. */
  readonly modes: string[];
  /** Answer of the next usage reads; a read rejects while it is `null`. */
  usage: unknown;
  usageReads: number;
}

export function scriptedRuntime(store: MemorySessionStore = new MemorySessionStore()): {
  readonly runtime: ClaudeRuntime;
  readonly queries: ScriptedQuery[];
} {
  const queries: ScriptedQuery[] = [];
  const runtime: ClaudeRuntime = {
    probe: () =>
      Promise.resolve({ account: { authenticated: true, label: "max" }, models: [], usage: null }),
    open(options): ClaudeQuery {
      const buffered: IteratorResult<unknown, void>[] = [];
      let failure: Error | null = null;
      let waiter: {
        resolve: (result: IteratorResult<unknown, void>) => void;
        reject: (error: Error) => void;
      } | null = null;
      const deliver = (result: IteratorResult<unknown, void>): void => {
        const pending = waiter;
        waiter = null;
        if (pending === null) buffered.push(result);
        else pending.resolve(result);
      };
      const location = { cwd: options.cwd, sessionId: options.identity.sessionId };
      const scripted: ScriptedQuery = {
        options,
        offers: [],
        modes: [],
        interrupts: 0,
        closed: false,
        usage: null,
        usageReads: 0,
        push: (frame) => {
          store.persistFrame(location, frame);
          deliver({ done: false, value: frame });
        },
        end: () => deliver({ done: true, value: undefined }),
        fail: (error) => {
          failure = error;
          const pending = waiter;
          waiter = null;
          pending?.reject(error);
        },
      };
      queries.push(scripted);
      return {
        offer: (prompt) => {
          scripted.offers.push(prompt);
          store.persistOffer(location, prompt);
        },
        interrupt: () => {
          scripted.interrupts += 1;
          return Promise.resolve();
        },
        close: () => {
          scripted.closed = true;
          deliver({ done: true, value: undefined });
        },
        next: () => {
          const next = buffered.shift();
          if (next !== undefined) return Promise.resolve(next);
          if (failure !== null) return Promise.reject(failure);
          return new Promise((resolve, reject) => {
            waiter = { resolve, reject };
          });
        },
        readUsage: () => {
          scripted.usageReads += 1;
          return scripted.usage === null
            ? Promise.reject(new Error("usage read unsupported"))
            : Promise.resolve(scripted.usage);
        },
        setPermissionMode: (mode) => {
          scripted.modes.push(mode);
          return Promise.resolve();
        },
      };
    },
  };
  return { runtime, queries };
}

/** One `tool.call` the session sent, answered by the test through `answer`. */
export interface RecordedToolCall {
  readonly params: ToolCallParams;
  readonly signal: AbortSignal;
  readonly answer: (result: ToolCallResult) => void;
}

export interface Harness {
  readonly service: ThreadService;
  readonly toolCalls: RecordedToolCall[];
  readonly store: MemorySessionStore;
  readonly events: AgentEvent[];
  readonly queries: ScriptedQuery[];
  readonly logs: readonly string[];
  readonly stateDirectory: string;
  readonly clock: { now: number };
  readonly rateLimits: RateLimitReporter;
  /** Every snapshot the reporter published. */
  readonly publishedLimits: ProviderRateLimits[];
  /** Session ids the fake `claude agents` reports as running; tests mutate it. */
  readonly runningSessions: Set<string>;
}

export function harness(
  options: {
    readonly interruptTimeoutMs?: number;
    readonly idleReleaseMs?: number;
    readonly stateDirectory?: string;
    readonly store?: MemorySessionStore;
    readonly openElsewherePollMs?: number;
    /** Recorded model id → catalog id; identity by default. */
    readonly modelIdFor?: (recorded: string) => string;
  } = {},
): Harness {
  const runningSessions = new Set<string>();
  const store = options.store ?? new MemorySessionStore();
  const { runtime, queries } = scriptedRuntime(store);
  const logger = createMemoryLogger();
  const events: AgentEvent[] = [];
  const clock = { now: 1_760_000_000_000 };
  const stateDirectory =
    options.stateDirectory ?? mkdtempSync(join(tmpdir(), "claude-agent-host-unit-"));
  const nowMs = (): number => clock.now;
  const toolCalls: RecordedToolCall[] = [];
  const publishedLimits: ProviderRateLimits[] = [];
  const rateLimits = new RateLimitReporter({
    logger,
    nowMs,
    publish: (limits) => publishedLimits.push(limits),
  });
  const service = new ThreadService({
    callClientTool: (params, signal) =>
      new Promise((resolve) => {
        const cancelled = (): void => {
          resolve({ success: false, content: [{ type: "text", text: "cancelled" }] });
        };
        signal.addEventListener("abort", cancelled, { once: true });
        toolCalls.push({ params, signal, answer: resolve });
      }),
    catalog: new SessionCatalog(store),
    sessionStore: store,
    stateStore: new ThreadStateStore(stateDirectory),
    runtime,
    logger,
    emit: (event) => events.push(event),
    nowMs,
    newUuid: counterUuids(),
    rateLimits,
    interruptTimeoutMs: options.interruptTimeoutMs ?? 50,
    idleReleaseMs: options.idleReleaseMs ?? 30 * 60 * 1000,
    backgroundDeferMaxMs: 4 * 60 * 60 * 1000,
    models: { idFor: options.modelIdFor ?? ((recorded) => recorded) },
    openElsewherePollMs: options.openElsewherePollMs ?? 60_000,
    runningSessions: { list: async () => new Set(runningSessions) },
  });
  return {
    service,
    toolCalls,
    store,
    events,
    queries,
    logs: logger.lines,
    stateDirectory,
    clock,
    runningSessions,
    rateLimits,
    publishedLimits,
  };
}

export const THREAD = "0199a3c4-7a8e-7b2c-9d1e-2f3a4b5c6d7e";
export const OTHER_THREAD = "0199a3c4-7a8e-7b2c-9d1e-2f3a4b5c6d7f";

export function createThread(
  service: ThreadService,
  appThreadId = THREAD,
  permissionProfile = ":workspace",
): void {
  const created = service.create(appThreadId, "/workspace", {
    model: "sonnet",
    effort: null,
    permissionProfile,
    serviceTier: null,
  });
  if (created.status !== "ok") throw new Error(created.message);
}

export const text = (value: string): readonly UserContent[] => [{ type: "text", text: value }];

/** A user message without a client id. */
export const prompt = (
  value: string,
): { readonly clientMessageId: null; readonly input: readonly UserContent[] } => ({
  clientMessageId: null,
  input: text(value),
});

/** The turn id of a started turn, or a thrown error. */
export function startedTurn(
  result: OperationResult<
    | { readonly type: "started"; readonly turnId: TurnId }
    | { readonly type: "busy"; readonly activeTurnId: TurnId }
  >,
): TurnId {
  if (result.status !== "ok" || result.value.type !== "started")
    throw new Error("turn did not start");
  return result.value.turnId;
}

/** Lets the session's read loop process everything pushed so far. */
export async function settle(): Promise<void> {
  for (let index = 0; index < 5; index += 1) await Promise.resolve();
  await new Promise((resolve) => setImmediate(resolve));
}

export const frames = {
  init: { type: "system", subtype: "init", mcp_servers: [], session_id: "s" },
  text: (messageId: string, text: string) => ({
    type: "assistant",
    message: { id: messageId, content: [{ type: "text", text }] },
    parent_tool_use_id: null,
  }),
  toolUse: (messageId: string, id: string, name: string, input: Record<string, unknown>) => ({
    type: "assistant",
    message: { id: messageId, content: [{ type: "tool_use", id, name, input }] },
    parent_tool_use_id: null,
  }),
  result: (overrides: Record<string, unknown> = {}) => ({
    type: "result",
    subtype: "success",
    is_error: false,
    terminal_reason: "completed",
    num_turns: 1,
    result: "ok",
    ...overrides,
  }),
  background: (count: number) => ({
    type: "system",
    subtype: "background_tasks_changed",
    tasks: Array.from({ length: count }, (_, index) => ({ task_id: `t${index}` })),
  }),
};
