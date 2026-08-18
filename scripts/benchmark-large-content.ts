import { rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { performance } from "node:perf_hooks";

import {
  ContentProjector,
  MAX_PROJECTED_ITEM_BYTES,
  MAX_PROJECTED_TURN_BYTES,
  PrivateContentService,
  takeProjectedPage,
} from "../apps/host-companion/src/index.js";

type RpcObject = Record<string, unknown>;

const turns = createDeterministicLargeTurns(64);
const sourceBytes = Buffer.byteLength(JSON.stringify(turns));
const contentDirectory = path.join(tmpdir(), `codewide-content-benchmark-${process.pid}`);
const service = new PrivateContentService(contentDirectory, () => true);
const projector = new ContentProjector(service);

try {
  const started = performance.now();
  const projectedTurns = turns.map((turn) => projector.projectTurn(turn));
  const durationMs = performance.now() - started;
  const itemSizes = projectedTurns.flatMap((turn) => Array.isArray(turn.items)
    ? turn.items.map((item) => Buffer.byteLength(JSON.stringify(item)))
    : []);
  const turnSizes = projectedTurns.map((turn) => Buffer.byteLength(JSON.stringify(turn)));
  const pages: number[] = [];
  for (let offset = 0; offset < turns.length;) {
    const page = takeProjectedPage(turns, offset, 12, (turn) => projector.projectTurn(turn));
    pages.push(Buffer.byteLength(JSON.stringify(page.data)));
    offset += Math.max(1, page.consumed);
  }

  const result = {
    fixture: "deterministic-large-content",
    sourceBytes,
    turns: turns.length,
    projectedItems: itemSizes.length,
    projectionDurationMs: Math.round(durationMs),
    maxProjectedItemBytes: Math.max(0, ...itemSizes),
    maxProjectedTurnBytes: Math.max(0, ...turnSizes),
    maxProjectedPageBytes: Math.max(0, ...pages),
    itemBudgetBytes: MAX_PROJECTED_ITEM_BYTES,
    turnBudgetBytes: MAX_PROJECTED_TURN_BYTES,
  };
  process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
  if (itemSizes.some((bytes) => bytes > MAX_PROJECTED_ITEM_BYTES)) throw new Error("Projected item exceeded its byte budget");
  if (turnSizes.some((bytes) => bytes > MAX_PROJECTED_TURN_BYTES)) throw new Error("Projected turn exceeded its byte budget");
} finally {
  await service.close();
  await rm(contentDirectory, { recursive: true, force: true });
}

function createDeterministicLargeTurns(count: number): RpcObject[] {
  const commandOutput = Array.from({ length: 8_192 }, (_, index) => `log-${index.toString().padStart(5, "0")} ${"x".repeat(48)}`).join("\n");
  const diff = Array.from({ length: 6_144 }, (_, index) => `${index % 2 === 0 ? "+" : "-"}line-${index.toString().padStart(5, "0")} ${"y".repeat(48)}`).join("\n");
  return Array.from({ length: count }, (_, index) => ({
    id: `large-turn-${index}`,
    itemsView: "full",
    status: "completed",
    items: [
      { id: `large-command-${index}`, type: "commandExecution", command: "fixture-command", aggregatedOutput: commandOutput, status: "completed" },
      { id: `large-diff-${index}`, type: "fileChange", changes: [{ path: `src/fixture-${index}.ts`, kind: "update", diff }], status: "completed" },
      { id: `large-agent-${index}`, type: "agentMessage", phase: "final_answer", text: `Deterministic final answer ${index}.` },
    ],
  }));
}
