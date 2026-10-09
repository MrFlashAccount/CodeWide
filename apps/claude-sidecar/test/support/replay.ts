/**
 * Replays an Agent SDK transcript (t3code `claude_transcript.ndjson` format)
 * through the real thread service with a fake query.
 *
 * The transcript is one shared cursor. The fake query yields `emit_inbound`
 * frames and calls `canUseTool` for `permission.request` frames; the driver
 * performs `expect_outbound` actions through the public service API:
 * `prompt.offer` → `turn.start` (or explicit `turn.steer` for `priority:
 * "now"`, or `thread.compact` for `/compact`), `query.interrupt` →
 * `turn.interrupt`. Runtime requests are answered from the recorded
 * `permission.response`. A `turn.start` answered `busy` is re-issued after
 * that thread's `turn.completed`. Clock and ids are deterministic.
 */

import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { AgentEvent, RuntimeResponse, UserContent } from "../../src/protocol.js";
import { asClientMessageId } from "../../src/protocol.js";
import type { ClaudeQuery, ClaudeRuntime, PromptOffer, QueryOpenOptions } from "../../src/claude/port.js";
import { createMemoryLogger } from "../../src/log.js";
import { Journal } from "../../src/journal/journal.js";
import { ThreadService } from "../../src/threads/service.js";

export interface TranscriptEntry {
  readonly type: string;
  readonly label?: string;
  readonly frame?: Record<string, unknown>;
  readonly status?: string;
  readonly metadata?: { readonly prompts?: readonly string[] };
}

export function loadTranscript(path: string): readonly TranscriptEntry[] {
  return readFileSync(path, "utf8")
    .split("\n")
    .filter((line) => line.trim().length > 0)
    .map((line) => JSON.parse(line) as TranscriptEntry); // WHY: transcript lines are fixture JSON with the envelope above.
}

export const REPLAY_THREAD_ID = "00000000-0000-4000-8000-0000000000aa";

/** Deterministic id generator: UUID-shaped counters. */
export function counterUuids(): () => string {
  let next = 0;
  return () => {
    next += 1;
    return `00000000-0000-4000-8000-${String(next).padStart(12, "0")}`;
  };
}

/** Deterministic clock advancing one second per read. */
export function steppingClock(startMs = 1_760_000_000_000): () => number {
  let now = startMs;
  return () => {
    now += 1000;
    return now;
  };
}

interface Signal {
  readonly promise: Promise<void>;
  readonly resolve: () => void;
}

function signal(): Signal {
  let resolve = (): void => {};
  const promise = new Promise<void>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}

function profileFor(entries: readonly TranscriptEntry[]): string {
  const open = entries.find((entry) => entry.type === "expect_outbound" && entry.frame?.["type"] === "query.open");
  const options = open?.frame?.["options"];
  if (typeof options !== "object" || options === null) return ":workspace";
  if (Array.isArray(Reflect.get(options, "tools"))) return ":read-only";
  return Reflect.get(options, "permissionMode") === "bypassPermissions" ? ":full-access" : ":workspace";
}

function offerInput(frame: Record<string, unknown>): { readonly input: readonly UserContent[]; readonly priority: unknown } {
  const message = frame["message"] as Record<string, unknown>; // WHY: prompt.offer frames always carry an SDK user message.
  const inner = message["message"] as Record<string, unknown>; // WHY: SDK user messages always carry a Messages API message.
  const content = inner["content"];
  const text =
    typeof content === "string"
      ? content
      : Array.isArray(content)
        ? content.map((block: unknown) => (typeof block === "object" && block !== null ? String(Reflect.get(block, "text") ?? "") : "")).join("\n")
        : "";
  return { input: [{ type: "text", text }], priority: message["priority"] };
}

function responseFor(entry: TranscriptEntry | undefined, event: Extract<AgentEvent, { type: "request.opened" }>): RuntimeResponse {
  const result = entry?.frame?.["result"];
  const behavior = typeof result === "object" && result !== null ? Reflect.get(result, "behavior") : "allow";
  if (event.request.type === "userInput") {
    const updatedInput = typeof result === "object" && result !== null ? Reflect.get(result, "updatedInput") : null;
    const answers = typeof updatedInput === "object" && updatedInput !== null ? Reflect.get(updatedInput, "answers") : null;
    const mapped: Record<string, { readonly answers: readonly string[] }> = {};
    for (const question of event.request.questions) {
      const answer = typeof answers === "object" && answers !== null ? Reflect.get(answers, question.question) : undefined;
      mapped[question.id] = { answers: typeof answer === "string" ? [answer] : [question.options[0]?.label ?? ""] };
    }
    return { type: "userInput", answers: mapped };
  }
  if (behavior === "deny") {
    const interrupt = typeof result === "object" && result !== null && Reflect.get(result, "interrupt") === true;
    return { type: "approval", decision: interrupt ? "cancel" : "decline" };
  }
  return { type: "approval", decision: "accept" };
}

export interface ReplayResult {
  readonly events: readonly AgentEvent[];
  readonly logs: readonly string[];
  readonly opens: readonly QueryOpenOptions[];
  readonly offers: readonly PromptOffer[];
}

/** Replays one transcript to completion and returns every emitted event. */
export async function replayTranscript(entries: readonly TranscriptEntry[]): Promise<ReplayResult> {
  const directory = mkdtempSync(join(tmpdir(), "claude-sidecar-replay-"));
  const logger = createMemoryLogger();
  const events: AgentEvent[] = [];
  const opens: QueryOpenOptions[] = [];
  const offers: PromptOffer[] = [];
  let cursor = 0;
  let advanced = signal();
  const advance = (): void => {
    cursor += 1;
    const previous = advanced;
    advanced = signal();
    previous.resolve();
  };
  let deferredStart: { readonly input: readonly UserContent[] } | null = null;
  let gate: Signal | null = null;

  const runtime: ClaudeRuntime = {
    probe: () => Promise.resolve({ account: null, models: [] }),
    open(options: QueryOpenOptions): ClaudeQuery {
      opens.push(options);
      let closed = false;
      return {
        offer: (prompt) => {
          offers.push(prompt);
        },
        interrupt: () => Promise.resolve(),
        close: () => {
          closed = true;
        },
        next: async () => {
          for (;;) {
            if (closed) return { done: true, value: undefined };
            const entry = entries[cursor];
            if (entry === undefined) return { done: true, value: undefined };
            if (entry.type === "transcript_start") {
              advance();
              continue;
            }
            if (entry.type === "expect_outbound") {
              await advanced.promise;
              continue;
            }
            if (entry.type === "runtime_exit") {
              // Advance only after the session has handled the exit, as a
              // real process exit is observed before the next prompt.
              closed = true;
              setTimeout(advance, 0);
              if (entry.status === "success") return { done: true, value: undefined };
              throw new Error(`recorded runtime exit: ${entry.status ?? "unknown"}`);
            }
            if (gate !== null) await gate.promise;
            const frame = entry.frame ?? {};
            if (frame["type"] === "permission.request") {
              advance();
              const frameOptions = (frame["options"] ?? {}) as Record<string, unknown>; // WHY: recorded canUseTool options object.
              await options.canUseTool({
                toolName: String(frame["toolName"]),
                input: (frame["input"] ?? {}) as Record<string, unknown>, // WHY: recorded tool input object.
                toolUseId: String(frameOptions["toolUseID"]),
                suggestions: Array.isArray(frameOptions["suggestions"]) ? frameOptions["suggestions"] : [],
                decisionReason: typeof frameOptions["decisionReason"] === "string" ? frameOptions["decisionReason"] : null,
                signal: new AbortController().signal,
              });
              if (entries[cursor]?.frame?.["type"] === "permission.response") advance();
              continue;
            }
            advance();
            if (frame["type"] === "result" && deferredStart !== null) gate = signal();
            return { done: false, value: frame };
          }
        },
      };
    },
  };

  const service = new ThreadService({
    journal: new Journal(directory),
    runtime,
    logger,
    emit: (event) => {
      events.push(event);
      if (event.type === "request.opened") {
        const recorded = entries.slice(cursor).find((entry) => entry.frame?.["type"] === "permission.response");
        queueMicrotask(() => {
          service.respond(REPLAY_THREAD_ID, event.requestId, responseFor(recorded, event));
        });
      }
      if (event.type === "turn.completed" && deferredStart !== null) {
        const pending = deferredStart;
        deferredStart = null;
        queueMicrotask(() => {
          service.startTurn(REPLAY_THREAD_ID, null, pending.input);
          const open = gate;
          gate = null;
          open?.resolve();
        });
      }
    },
    nowMs: steppingClock(),
    newUuid: counterUuids(),
    interruptTimeoutMs: 200,
    idleReleaseMs: 60 * 60 * 1000,
    backgroundDeferMaxMs: 4 * 60 * 60 * 1000,
  });
  service.create(REPLAY_THREAD_ID, "/workspace", { model: "claude-sonnet-4-6", effort: null, permissionProfile: profileFor(entries), serviceTier: null });

  let clientMessages = 0;
  try {
    while (cursor < entries.length) {
      const entry = entries[cursor];
      if (entry === undefined) break;
      if (entry.type === "transcript_start" || (entry.type === "expect_outbound" && entry.frame?.["type"] === "query.open")) {
        advance();
        continue;
      }
      if (entry.type === "expect_outbound" && entry.frame?.["type"] === "prompt.offer") {
        const { input, priority } = offerInput(entry.frame);
        clientMessages += 1;
        const clientMessageId = asClientMessageId(`replay-${clientMessages}`);
        const active = service.read(REPLAY_THREAD_ID);
        const activeTurnId = active.status === "ok" ? active.value.activeTurnId : null;
        const text = input[0]?.type === "text" ? input[0].text : "";
        if (text === "/compact") {
          service.compact(REPLAY_THREAD_ID);
        } else if (priority === "now" && activeTurnId !== null) {
          service.steer(REPLAY_THREAD_ID, activeTurnId, clientMessageId, input);
        } else {
          const started = service.startTurn(REPLAY_THREAD_ID, clientMessageId, input);
          if (started.status === "ok" && started.value.type === "busy") deferredStart = { input };
        }
        advance();
        continue;
      }
      if (entry.type === "expect_outbound" && entry.frame?.["type"] === "query.interrupt") {
        const active = service.read(REPLAY_THREAD_ID);
        service.interrupt(REPLAY_THREAD_ID, active.status === "ok" ? active.value.activeTurnId : null);
        advance();
        continue;
      }
      const position = cursor;
      await Promise.race([advanced.promise, new Promise((resolve) => setTimeout(resolve, 2000))]);
      if (cursor === position) throw new Error(`replay stalled at entry ${position} (${entry.type} ${entry.label ?? ""})`);
    }
    // Let the last frames, timers and microtasks settle.
    await new Promise((resolve) => setTimeout(resolve, 250));
    service.shutdown();
    return { events, logs: logger.lines, opens, offers };
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
}
