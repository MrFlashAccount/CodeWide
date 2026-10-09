/**
 * Token and cost accounting contracts: a turn reports the usage of every
 * model the query pipeline used during it (cumulative `modelUsage`
 * differenced against the session's earlier totals), `last` is the context
 * size of the turn's final top-level request, costs come from the SDK only
 * when their price table is known, and a history read returns the usage a
 * turn reported without emitting events.
 */

import { describe, expect, it } from "vitest";
import type { ModelTotals } from "../src/mapping/frames.js";
import { meterResult, NEW_SESSION_BASELINE, type UsageBaseline } from "../src/mapping/usage.js";
import type { AgentEvent, TokenUsage } from "../src/protocol.js";
import { createThread, frames, harness, prompt, settle, THREAD } from "./support/scripted.js";

interface Counters {
  readonly cacheCreationInputTokens?: number;
  readonly cacheReadInputTokens?: number;
  readonly canonicalModel?: string;
  readonly costBasis?: "list" | "managed" | "unknown";
  readonly costUSD?: number;
  readonly inputTokens?: number;
  readonly outputTokens?: number;
  readonly thinkingTokens?: number;
}

/** A result frame whose `modelUsage` carries the given cumulative totals. */
const resultWith = (
  totals: Readonly<Record<string, Counters>>,
  overrides: Record<string, unknown> = {},
) =>
  frames.result({
    modelUsage: Object.fromEntries(
      Object.entries(totals).map(([model, counters]) => [
        model,
        {
          cacheCreationInputTokens: 0,
          cacheReadInputTokens: 0,
          contextWindow: 200_000,
          costUSD: 0,
          inputTokens: 0,
          maxOutputTokens: 32_000,
          outputTokens: 0,
          webSearchRequests: 0,
          ...counters,
        },
      ]),
    ),
    ...overrides,
  });

/** An assistant message with its request's token counts. */
const assistant = (
  messageId: string,
  usage: {
    readonly cacheCreation: number;
    readonly cacheRead: number;
    readonly input: number;
    readonly output: number;
  },
  parentToolUseId: string | null = null,
) => ({
  type: "assistant",
  message: {
    content: [{ text: `reply ${messageId}`, type: "text" }],
    id: messageId,
    usage: {
      cache_creation_input_tokens: usage.cacheCreation,
      cache_read_input_tokens: usage.cacheRead,
      input_tokens: usage.input,
      output_tokens: usage.output,
    },
  },
  parent_tool_use_id: parentToolUseId,
});

const usageEvents = (events: readonly AgentEvent[]) =>
  events.flatMap((event) => (event.type === "usage.updated" ? [event] : []));

const tokens = (
  input: number,
  cached: number,
  cacheWrite: number,
  output: number,
  reasoning = 0,
): TokenUsage => ({
  cacheWriteInputTokens: cacheWrite,
  cachedInputTokens: cached,
  inputTokens: input + cached + cacheWrite,
  outputTokens: output,
  reasoningOutputTokens: reasoning,
  totalTokens: input + cached + cacheWrite + output,
});

const total = (event: AgentEvent | undefined): number =>
  event?.type === "usage.updated" ? event.total.totalTokens : -1;

const turnTokens = (event: AgentEvent | undefined, previous: AgentEvent | undefined): number =>
  total(event) - (previous === undefined ? 0 : total(previous));

async function runTurn(
  service: ReturnType<typeof harness>["service"],
  push: () => void,
): Promise<void> {
  const started = await service.startTurn(THREAD, prompt("go"));
  if (started.status !== "ok") throw new Error(started.message);
  push();
  await settle();
}

describe("turn usage", () => {
  it("reports the last top-level request as `last` and every model of the turn as its usage", async () => {
    const { service, queries, events } = harness();
    createThread(service);
    await runTurn(service, () => {
      const query = queries[0];
      query?.push(frames.init);
      query?.push(assistant("m1", { cacheCreation: 50, cacheRead: 1_000, input: 100, output: 20 }));
      // A subagent request never sets the context size of the thread.
      query?.push(
        assistant("s1", { cacheCreation: 0, cacheRead: 0, input: 90_000, output: 500 }, "toolu_1"),
      );
      query?.push(assistant("m2", { cacheCreation: 30, cacheRead: 1_200, input: 10, output: 40 }));
      query?.push(
        resultWith({
          "claude-haiku-4-5": { costUSD: 0.002, inputTokens: 90_000, outputTokens: 500 },
          "claude-sonnet-4-6": {
            cacheCreationInputTokens: 80,
            cacheReadInputTokens: 2_200,
            canonicalModel: "claude-sonnet-4-6",
            costBasis: "managed",
            costUSD: 0.01,
            inputTokens: 110,
            outputTokens: 60,
            thinkingTokens: 15,
          },
        }),
      );
    });
    const [usage] = usageEvents(events);
    expect(usage).toMatchObject({
      contextWindow: 200_000,
      cost: { basis: "managed", model: "mixed", threadUsd: 0.012, turnUsd: 0.012 },
      last: tokens(10, 1_200, 30, 40),
      total: {
        cacheWriteInputTokens: 80,
        cachedInputTokens: 2_200,
        inputTokens: 92_390,
        outputTokens: 560,
        reasoningOutputTokens: 15,
        totalTokens: 92_950,
      },
    });
  });

  it("counts results that do not end the turn and measures later turns from them", async () => {
    const { service, queries, events } = harness();
    createThread(service);
    const started = await service.startTurn(THREAD, prompt("first"));
    if (started.status !== "ok" || started.value.type !== "started") throw new Error("no turn");
    const query = queries[0];
    query?.push(frames.init);
    await settle();
    await service.steer(THREAD, started.value.turnId, prompt("also"));
    // The steer's aborted restart result and a task-notification result inside the user turn.
    query?.push(
      resultWith(
        { sonnet: { costUSD: 0.001, inputTokens: 100, outputTokens: 10 } },
        { subtype: "error_during_execution", is_error: true, terminal_reason: "aborted_streaming" },
      ),
    );
    query?.push(
      resultWith(
        { sonnet: { costUSD: 0.003, inputTokens: 300, outputTokens: 30 } },
        { origin: { kind: "task-notification" } },
      ),
    );
    query?.push(resultWith({ sonnet: { costUSD: 0.004, inputTokens: 400, outputTokens: 40 } }));
    await settle();
    await runTurn(service, () => {
      queries[0]?.push(
        resultWith({ sonnet: { costUSD: 0.005, inputTokens: 450, outputTokens: 50 } }),
      );
    });
    const [first, second] = usageEvents(events);
    expect(usageEvents(events)).toHaveLength(2);
    expect(first).toMatchObject({
      cost: { threadUsd: 0.004, turnUsd: 0.004 },
      total: tokens(400, 0, 0, 40),
    });
    expect(second).toMatchObject({
      cost: { threadUsd: 0.005, turnUsd: 0.001 },
      total: tokens(450, 0, 0, 50),
    });
    expect(turnTokens(second, first)).toBe(60);
  });

  it("gives a wake turn only its own usage and the next turn what no turn measured", async () => {
    const { service, queries, events } = harness();
    createThread(service);
    await runTurn(service, () => {
      queries[0]?.push(frames.init);
      queries[0]?.push(resultWith({ sonnet: { inputTokens: 100, outputTokens: 10 } }));
    });
    // A background task wakes the session: its content starts a provider turn.
    queries[0]?.push(assistant("w1", { cacheCreation: 0, cacheRead: 100, input: 5, output: 7 }));
    queries[0]?.push(
      resultWith(
        { sonnet: { inputTokens: 150, outputTokens: 20 } },
        { origin: { kind: "task-notification" } },
      ),
    );
    await settle();
    // A result with no turn to own it is left for the next turn.
    queries[0]?.push(resultWith({ sonnet: { inputTokens: 170, outputTokens: 25 } }));
    await settle();
    await runTurn(service, () => {
      queries[0]?.push(resultWith({ sonnet: { inputTokens: 200, outputTokens: 30 } }));
    });
    const reported = usageEvents(events);
    expect(reported.map((event, index) => turnTokens(event, reported[index - 1]))).toEqual([
      110, 60, 60,
    ]);
    const completions = events.flatMap((event) =>
      event.type === "turn.completed" ? [event.turn.origin] : [],
    );
    expect(completions).toEqual(["user", "provider", "user"]);
  });

  it("measures a resumed query from restored totals and a fresh or cleared one from zero", async () => {
    const { service, queries, events } = harness();
    createThread(service);
    await runTurn(service, () => {
      queries[0]?.push(frames.init);
      queries[0]?.push(
        resultWith({ sonnet: { costUSD: 0.01, inputTokens: 1_000, outputTokens: 100 } }),
      );
    });
    queries[0]?.end();
    await settle();
    // The resumed session restored the totals its transcript saved.
    await runTurn(service, () => {
      queries[1]?.push(frames.init);
      queries[1]?.push(
        resultWith({ sonnet: { costUSD: 0.012, inputTokens: 1_200, outputTokens: 120 } }),
      );
    });
    queries[1]?.end();
    await settle();
    // This resumed session restored no totals.
    await runTurn(service, () => {
      queries[2]?.push(frames.init);
      queries[2]?.push(
        resultWith({ sonnet: { costUSD: 0.003, inputTokens: 300, outputTokens: 30 } }),
      );
    });
    // A mid-session `/clear` restarts the running total.
    await runTurn(service, () => {
      queries[2]?.push(
        resultWith({ sonnet: { costUSD: 0.001, inputTokens: 50, outputTokens: 5 } }),
      );
    });
    const reported = usageEvents(events);
    expect(reported.map((event, index) => turnTokens(event, reported[index - 1]))).toEqual([
      1_100, 220, 330, 55,
    ]);
    expect(reported.at(-1)).toMatchObject({ cost: { threadUsd: 0.016, turnUsd: 0.001 } });
  });

  it("ignores zeroed crash results and keeps measuring from the earlier totals", async () => {
    const { service, queries, events } = harness();
    createThread(service);
    await runTurn(service, () => {
      queries[0]?.push(frames.init);
      queries[0]?.push(resultWith({ sonnet: { inputTokens: 100, outputTokens: 10 } }));
    });
    await runTurn(service, () => {
      queries[0]?.push(
        frames.result({ modelUsage: {}, subtype: "error_during_execution", is_error: true }),
      );
    });
    await runTurn(service, () => {
      queries[0]?.push(resultWith({ sonnet: { inputTokens: 130, outputTokens: 15 } }));
    });
    const reported = usageEvents(events);
    expect(reported).toHaveLength(2);
    expect(turnTokens(reported[1], reported[0])).toBe(35);
  });

  it("reports no cost once a turn's model was priced from an unknown table", async () => {
    const { service, queries, events } = harness();
    createThread(service);
    await runTurn(service, () => {
      queries[0]?.push(frames.init);
      queries[0]?.push(resultWith({ sonnet: { costUSD: 0.01, inputTokens: 100 } }));
    });
    await runTurn(service, () => {
      queries[0]?.push(
        resultWith({
          custom: { costBasis: "unknown", costUSD: 0.5, inputTokens: 10 },
          sonnet: { costUSD: 0.01, inputTokens: 100 },
        }),
      );
    });
    await runTurn(service, () => {
      queries[0]?.push(
        resultWith({
          custom: { costBasis: "unknown", costUSD: 0.5, inputTokens: 10 },
          sonnet: { costUSD: 0.02, inputTokens: 200 },
        }),
      );
    });
    const [first, second, third] = usageEvents(events);
    expect(first).toMatchObject({
      cost: { basis: "list", model: "sonnet", threadUsd: 0.01, turnUsd: 0.01 },
    });
    expect(second).not.toHaveProperty("cost");
    expect(third).toMatchObject({ cost: { threadUsd: null, turnUsd: 0.01 } });
  });

  it("returns a finished turn's reported usage on a history read without emitting usage", async () => {
    const { service, queries, events } = harness();
    createThread(service);
    await runTurn(service, () => {
      queries[0]?.push(frames.init);
      queries[0]?.push(assistant("m1", { cacheCreation: 5, cacheRead: 50, input: 10, output: 3 }));
      queries[0]?.push(
        resultWith({ sonnet: { costUSD: 0.01, inputTokens: 100, outputTokens: 10 } }),
      );
    });
    const [reported] = usageEvents(events);
    const before = events.length;
    const read = await service.turns({
      appThreadId: THREAD,
      cursor: null,
      itemsView: "full",
      limit: 10,
      sortDirection: "asc",
    });
    if (read.status !== "ok" || reported?.type !== "usage.updated") throw new Error("no read");
    expect(read.value.turns[0]?.usage).toEqual({
      contextWindow: reported.contextWindow,
      cost: reported.cost,
      last: reported.last,
      total: reported.total,
      turn: reported.total,
    });
    expect(events.length).toBe(before);
  });
});

describe("meterResult", () => {
  const model = (name: string, counters: Counters): ModelTotals => ({
    cacheCreationInputTokens: counters.cacheCreationInputTokens ?? 0,
    cacheReadInputTokens: counters.cacheReadInputTokens ?? 0,
    canonicalModel: counters.canonicalModel ?? null,
    contextWindow: 200_000,
    costBasis: counters.costBasis ?? "list",
    costUsd: counters.costUSD ?? 0,
    inputTokens: counters.inputTokens ?? 0,
    model: name,
    outputTokens: counters.outputTokens ?? 0,
    thinkingTokens: counters.thinkingTokens ?? 0,
  });
  const measure = (baseline: UsageBaseline, totals: readonly ModelTotals[]) =>
    meterResult(baseline, {
      mainLoop: {
        cacheCreationInputTokens: 0,
        cacheReadInputTokens: 0,
        inputTokens: 7,
        outputTokens: 3,
      },
      totals,
    });

  it("measures a restored older running total from the checkpoint it continues", () => {
    const first = measure(NEW_SESSION_BASELINE, [
      model("sonnet", { costUSD: 0.1, inputTokens: 1_000 }),
    ]);
    // Another run whose totals do not include the first.
    const other = measure(first.baseline, [
      model("sonnet", { costUSD: 0.3, inputTokens: 13 }),
      model("haiku", { costUSD: 0.04, inputTokens: 10 }),
    ]);
    // A run that restored the first run's saved totals and continued it.
    const restored = measure(other.baseline, [
      model("sonnet", { costUSD: 0.12, inputTokens: 1_020 }),
    ]);
    expect(other.delta?.usage.inputTokens).toBe(23);
    expect(restored.delta?.usage.inputTokens).toBe(20);
    expect(restored.delta?.cost).toEqual({
      basis: "list",
      models: ["sonnet"],
      type: "priced",
      usd: 0.02,
    });
  });

  it("counts only the main-loop usage, unpriced, for a session without a baseline", () => {
    const { baseline, delta } = measure({ type: "unknown" }, [
      model("sonnet", { costUSD: 9, inputTokens: 50_000 }),
    ]);
    expect(delta?.usage).toEqual(tokens(7, 0, 0, 3));
    expect(delta?.cost).toEqual({ type: "unpriced" });
    const next = measure(baseline, [model("sonnet", { costUSD: 9.5, inputTokens: 50_100 })]);
    expect(next.delta?.usage.inputTokens).toBe(100);
  });
});
