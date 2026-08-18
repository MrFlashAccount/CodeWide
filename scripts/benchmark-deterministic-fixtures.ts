import { performance } from "node:perf_hooks";

import { createLargeFixtureThread } from "../packages/fixtures/src/index.js";
import { connectionId, normalizeThread, normalizeThreadItem } from "../packages/domain/src/index.js";
import { toRenderBlock } from "../packages/renderers/src/index.js";
import { applyThreadEventsImmutable } from "../packages/sync-client/src/thread-events.js";
import { selectTurnRenderWindow } from "../apps/android/src/rendering/thread-render-window.js";

const fixture = createLargeFixtureThread(1_000);
const serialized = JSON.stringify(fixture);
const benchmarkConnection = connectionId("fixture-benchmark");
const parseSamples = sample(50, () => { JSON.parse(serialized); });
const projectionSamples = sample(20, () => {
  normalizeThread(benchmarkConnection, fixture).turns.flatMap((turn) => turn.items.map(toRenderBlock));
});
const largestTurn = fixture.turns[0];
const activeTurn = largestTurn === undefined ? undefined : { ...largestTurn, status: "inProgress" as const };
const activeTurnSamples = activeTurn === undefined ? [0] : sample(50, () => {
  const window = selectTurnRenderWindow(activeTurn);
  const selectedIndexes = [
    ...window.userItemIndexes,
    ...(window.latestAgentIndex < 0 ? [] : [window.latestAgentIndex]),
    ...window.liveActivityIndexes,
  ];
  selectedIndexes.flatMap((itemIndex) => {
    const item = activeTurn.items[itemIndex];
    return item === undefined
      ? []
      : [toRenderBlock(normalizeThreadItem(benchmarkConnection, fixture.id, activeTurn.id, item, itemIndex))];
  });
});
const timelineRows = new WeakMap<object, { id: string; turn: (typeof fixture.turns)[number] }>();
const cachedAssemblySamples = sample(100, () => {
  fixture.turns.map((turn) => {
    const cached = timelineRows.get(turn);
    if (cached !== undefined) return cached;
    const row = { id: turn.id, turn };
    timelineRows.set(turn, row);
    return row;
  });
});
const liveTarget = [...fixture.turns].reverse().flatMap((turn) => {
  const item = [...turn.items].reverse().find((candidate) => candidate.type === "agentMessage");
  return item === undefined ? [] : [{ turnId: turn.id, itemId: item.id }];
})[0];
let liveThread = structuredClone(fixture);
const liveDeltaSamples = liveTarget === undefined ? [0] : sample(200, () => {
  liveThread = applyThreadEventsImmutable(liveThread, [{
    method: "item/agentMessage/delta",
    params: { threadId: fixture.id, turnId: liveTarget.turnId, itemId: liveTarget.itemId, delta: "x" },
  }]);
});

const result = {
  turns: fixture.turns.length,
  items: fixture.turns.reduce((total, turn) => total + turn.items.length, 0),
  bytes: Buffer.byteLength(serialized),
  parse: percentiles(parseSamples),
  normalizeAndProject: percentiles(projectionSamples),
  windowedActiveTurnProjection: percentiles(activeTurnSamples),
  rawTimelineAssembly: percentiles(cachedAssemblySamples),
  indexedLiveDelta: percentiles(liveDeltaSamples),
};

process.stdout.write(`${JSON.stringify({ environment: "node-desktop-control-only", fixture: result }, null, 2)}\n`);

if (
  result.parse.p95Ms >= 50
  || result.normalizeAndProject.p95Ms >= 75
  || result.windowedActiveTurnProjection.p95Ms >= 5
  || result.rawTimelineAssembly.p95Ms >= 5
  || result.indexedLiveDelta.p95Ms >= 5
) throw new Error("Deterministic fixture benchmark exceeded its p95 guardrail");

function sample(iterations: number, run: () => void): number[] {
  const values: number[] = [];
  for (let index = 0; index < iterations; index += 1) {
    const started = performance.now();
    run();
    values.push(performance.now() - started);
  }
  return values.sort((left, right) => left - right);
}

function percentiles(values: number[]): { p50Ms: number; p95Ms: number; maxMs: number } {
  return {
    p50Ms: round(values[Math.floor(values.length * 0.5)] ?? 0),
    p95Ms: round(values[Math.floor(values.length * 0.95)] ?? 0),
    maxMs: round(values.at(-1) ?? 0),
  };
}

function round(value: number): number {
  return Math.round(value * 100) / 100;
}
