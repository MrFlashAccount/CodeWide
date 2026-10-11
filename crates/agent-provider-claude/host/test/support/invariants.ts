/**
 * Oracle for the neutral ordering rules of `codewide-agent` v1 turns.
 *
 * Returns human-readable violations (empty when the stream is valid):
 * turn.started before items; userMessage first in user turns; deltas only on
 * started, open items of the matching type; every item completed before
 * turn.completed; at most one final answer per turn; requests resolved before
 * their turn completes; turn.completed lists exactly the started items.
 */

import type { AgentEvent } from "../../src/protocol.js";

interface TurnState {
  readonly origin: "user" | "provider";
  readonly items: Map<string, { readonly type: string; completed: boolean }>;
  finals: number;
  completed: boolean;
}

const deltaType = {
  text: "agentMessage",
  reasoning: "reasoning",
  output: "command",
  fileChanges: "fileChange",
} as const;

export function turnViolations(
  events: readonly AgentEvent[],
  options: { readonly allowUnstartedCompletion?: boolean } = {},
): readonly string[] {
  const violations: string[] = [];
  const turns = new Map<string, TurnState>();
  const openRequests = new Map<string, string>();
  const turnOf = (turnId: string, index: number, what: string): TurnState | null => {
    const turn = turns.get(turnId);
    if (turn === undefined) violations.push(`#${index} ${what}: turn ${turnId} was not started`);
    else if (turn.completed) violations.push(`#${index} ${what}: turn ${turnId} already completed`);
    return turn ?? null;
  };
  events.forEach((event, index) => {
    switch (event.type) {
      case "turn.started":
        if (turns.has(event.turn.turnId))
          violations.push(`#${index} turn ${event.turn.turnId} started twice`);
        turns.set(event.turn.turnId, {
          origin: event.turn.origin,
          items: new Map(),
          finals: 0,
          completed: false,
        });
        break;
      case "item.started": {
        const turn = turnOf(event.turnId, index, "item.started");
        if (turn === null) break;
        if (turn.origin === "user" && turn.items.size === 0 && event.item.type !== "userMessage") {
          violations.push(`#${index} first item of a user turn is ${event.item.type}`);
        }
        if (turn.items.has(event.item.itemId))
          violations.push(`#${index} item ${event.item.itemId} started twice`);
        turn.items.set(event.item.itemId, { type: event.item.type, completed: false });
        break;
      }
      case "item.delta": {
        const turn = turnOf(event.turnId, index, "item.delta");
        const item = turn?.items.get(event.itemId);
        if (item === undefined) violations.push(`#${index} delta for unknown item ${event.itemId}`);
        else if (item.completed)
          violations.push(`#${index} delta for completed item ${event.itemId}`);
        else if (item.type !== deltaType[event.delta.kind])
          violations.push(`#${index} ${event.delta.kind} delta on ${item.type}`);
        break;
      }
      case "item.completed": {
        const turn = turnOf(event.turnId, index, "item.completed");
        const item = turn?.items.get(event.item.itemId);
        if (turn === null) break;
        if (item === undefined)
          violations.push(`#${index} completion of unstarted item ${event.item.itemId}`);
        else if (item.completed)
          violations.push(`#${index} item ${event.item.itemId} completed twice`);
        else item.completed = true;
        if (event.item.type === "agentMessage" && event.item.phase === "final") turn.finals += 1;
        if (turn.finals > 1)
          violations.push(`#${index} more than one final answer in turn ${event.turnId}`);
        break;
      }
      case "request.opened":
        turnOf(event.turnId, index, "request.opened");
        openRequests.set(String(event.requestId), event.turnId);
        break;
      case "request.resolved":
        if (!openRequests.delete(String(event.requestId)))
          violations.push(`#${index} resolution of unknown request ${String(event.requestId)}`);
        break;
      case "usage.updated":
      case "plan.updated":
      case "diff.updated":
        turnOf(event.turnId, index, event.type);
        break;
      case "turn.completed": {
        const turn = turns.get(event.turn.turnId);
        if (turn === undefined) {
          if (options.allowUnstartedCompletion !== true)
            violations.push(`#${index} completion of unstarted turn ${event.turn.turnId}`);
          break;
        }
        if (turn.completed) violations.push(`#${index} turn ${event.turn.turnId} completed twice`);
        turn.completed = true;
        for (const [itemId, item] of turn.items)
          if (!item.completed) violations.push(`#${index} item ${itemId} still open at turn end`);
        for (const [requestId, turnId] of openRequests) {
          if (turnId === event.turn.turnId)
            violations.push(`#${index} request ${requestId} still open at turn end`);
        }
        const listed = event.turn.items.map((item) => item.itemId).join(",");
        const started = [...turn.items.keys()].join(",");
        if (listed !== started)
          violations.push(
            `#${index} turn.completed items [${listed}] differ from started [${started}]`,
          );
        break;
      }
      default:
        break;
    }
  });
  for (const [turnId, turn] of turns)
    if (!turn.completed) violations.push(`turn ${turnId} never completed`);
  return violations;
}
