/**
 * A hand-driven fake runtime for session unit tests: each opened query
 * exposes `push(frame)`, `end()` and `fail(error)` and records offers,
 * interrupts and closes.
 */

import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { AgentEvent } from "../../src/protocol.js";
import type { ClaudeQuery, ClaudeRuntime, PromptOffer, QueryOpenOptions } from "../../src/claude/port.js";
import { createMemoryLogger } from "../../src/log.js";
import { Journal } from "../../src/journal/journal.js";
import { ThreadService } from "../../src/threads/service.js";
import { counterUuids } from "./replay.js";

export interface ScriptedQuery {
  readonly options: QueryOpenOptions;
  readonly offers: PromptOffer[];
  interrupts: number;
  closed: boolean;
  readonly push: (frame: unknown) => void;
  readonly end: () => void;
  readonly fail: (error: Error) => void;
}

export function scriptedRuntime(): { readonly runtime: ClaudeRuntime; readonly queries: ScriptedQuery[] } {
  const queries: ScriptedQuery[] = [];
  const runtime: ClaudeRuntime = {
    probe: () => Promise.resolve({ account: { authenticated: true, label: "max" }, models: [] }),
    open(options): ClaudeQuery {
      const buffered: IteratorResult<unknown, void>[] = [];
      let failure: Error | null = null;
      let waiter: { resolve: (result: IteratorResult<unknown, void>) => void; reject: (error: Error) => void } | null = null;
      const deliver = (result: IteratorResult<unknown, void>): void => {
        const pending = waiter;
        waiter = null;
        if (pending === null) buffered.push(result);
        else pending.resolve(result);
      };
      const scripted: ScriptedQuery = {
        options,
        offers: [],
        interrupts: 0,
        closed: false,
        push: (frame) => deliver({ done: false, value: frame }),
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
        offer: (prompt) => scripted.offers.push(prompt),
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
      };
    },
  };
  return { runtime, queries };
}

export interface Harness {
  readonly service: ThreadService;
  readonly events: AgentEvent[];
  readonly queries: ScriptedQuery[];
  readonly logs: readonly string[];
  readonly journalDirectory: string;
  readonly clock: { now: number };
}

export function harness(options: { readonly interruptTimeoutMs?: number; readonly idleReleaseMs?: number; readonly journalDirectory?: string } = {}): Harness {
  const { runtime, queries } = scriptedRuntime();
  const logger = createMemoryLogger();
  const events: AgentEvent[] = [];
  const clock = { now: 1_760_000_000_000 };
  const journalDirectory = options.journalDirectory ?? mkdtempSync(join(tmpdir(), "claude-sidecar-unit-"));
  const service = new ThreadService({
    journal: new Journal(journalDirectory),
    runtime,
    logger,
    emit: (event) => events.push(event),
    nowMs: () => clock.now,
    newUuid: counterUuids(),
    interruptTimeoutMs: options.interruptTimeoutMs ?? 50,
    idleReleaseMs: options.idleReleaseMs ?? 30 * 60 * 1000,
    backgroundDeferMaxMs: 4 * 60 * 60 * 1000,
  });
  return { service, events, queries, logs: logger.lines, journalDirectory, clock };
}

export const THREAD = "0199a3c4-7a8e-7b2c-9d1e-2f3a4b5c6d7e";
export const OTHER_THREAD = "0199a3c4-7a8e-7b2c-9d1e-2f3a4b5c6d7f";

export function createThread(service: ThreadService, appThreadId = THREAD, permissionProfile = ":workspace"): void {
  const created = service.create(appThreadId, "/workspace", { model: "sonnet", effort: null, permissionProfile, serviceTier: null });
  if (created.status !== "ok") throw new Error(created.message);
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
  background: (count: number) => ({ type: "system", subtype: "background_tasks_changed", tasks: Array.from({ length: count }, (_, index) => ({ task_id: `t${index}` })) }),
};
