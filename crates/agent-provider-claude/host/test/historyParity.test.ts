/**
 * Live ↔ history parity: every recorded transcript is replayed through the
 * real thread service while a fake Claude store persists what the CLI would
 * persist; the thread's history read back through `thread.turns` must equal
 * the turns the live path completed, apart from the documented losses of
 * Claude's store (reasoning text, structured tool results, durations).
 */

import { readdirSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import type { AgentItem, AgentTurn } from "../src/protocol.js";
import { asAppThreadId } from "../src/protocol.js";
import { reconstructTurns } from "../src/history/reconstruct.js";
import { loadTranscript, REPLAY_THREAD_ID, replayTranscript } from "./support/replay.js";

const fixtureDirectory = join(import.meta.dirname, "fixtures");
const scenarios = readdirSync(fixtureDirectory)
  .filter((name) => name.endsWith(".ndjson"))
  .map((name) => name.slice(0, -".ndjson".length))
  .toSorted();

/** Removes what Claude's store cannot carry. */
function comparable(item: AgentItem): unknown {
  switch (item.type) {
    case "reasoning":
      return { itemId: item.itemId, type: item.type };
    case "command":
      return { ...item, durationMs: null, output: null };
    case "fileChange":
      return {
        itemId: item.itemId,
        paths: item.changes.map((change) => change.path),
        status: item.status,
        type: item.type,
      };
    case "mcpToolCall":
    case "toolCall":
      return { ...item, durationMs: null };
    default:
      return item;
  }
}

const comparableTurn = (turn: AgentTurn): unknown => ({
  error: turn.error,
  items: turn.items.map(comparable),
  origin: turn.origin,
  status: turn.status,
  turnId: turn.turnId,
});

describe("history parity", () => {
  for (const scenario of scenarios) {
    it(scenario, async () => {
      const { events, history } = await replayTranscript(
        loadTranscript(join(fixtureDirectory, `${scenario}.ndjson`)),
      );
      const live = events.flatMap((event) => (event.type === "turn.completed" ? [event.turn] : []));
      expect(history.map(comparableTurn)).toEqual(live.map(comparableTurn));
    });
  }
});

/** What a session typed in a terminal looks like: no host index, so no client ids. */
function withoutHostIndex(turn: AgentTurn): unknown {
  const items = turn.items.map((item) =>
    item.type === "userMessage" ? { ...item, clientMessageId: null } : item,
  );
  return comparableTurn({ ...turn, items });
}

/**
 * Without the index, turn boundaries and outcomes are derived from the
 * transcript alone. These scenarios lose them, for the reason given; their
 * items must still match live in order.
 */
const DERIVED_BOUNDARY_LOSSES: Readonly<Record<string, string>> = {
  claude_background_monitor_wake:
    "wake turns start without a stored wake message in this fake store",
  claude_background_subagent_after_root:
    "wake turns start without a stored wake message in this fake store",
  claude_background_subagent_lifecycle:
    "wake turns start without a stored wake message in this fake store",
  claude_background_task_interrupt:
    "the interrupt marker is written by the CLI, not by this fake store",
  claude_background_task_wake: "wake turns start without a stored wake message in this fake store",
  claude_background_wake_before_queued_prompt:
    "wake turns start without a stored wake message in this fake store",
  claude_background_wake_before_queued_prompt_no_echo:
    "wake turns start without a stored wake message in this fake store",
  claude_compact_after_peer_turn: "peer and /compact turns have no stored start message",
  claude_compact_after_peer_turn_no_echo: "peer and /compact turns have no stored start message",
  claude_compact_after_resume_wake: "wake and /compact turns have no stored start message",
  claude_nested_background_subagent_wake:
    "wake turns start without a stored wake message in this fake store",
  claude_result_is_error: "a failed outcome exists only in the host's index",
  codewide_lost_session: "the resent first prompt looks like a new prompt",
  codewide_process_exit: "a failed outcome exists only in the host's index",
  message_steering: "a steer looks like a new prompt",
  turn_interrupt: "the interrupt marker is written by the CLI, not by this fake store",
  turn_interrupt_mid_tool: "the interrupt marker is written by the CLI, not by this fake store",
  turn_interrupt_restart: "the interrupt marker is written by the CLI, not by this fake store",
};

const itemIds = (turns: readonly AgentTurn[]): readonly string[] =>
  turns.flatMap((turn) =>
    turn.items.filter((item) => item.type !== "userMessage").map((item) => item.itemId),
  );

describe("history parity without the host's turn index", () => {
  for (const scenario of scenarios) {
    it(scenario, async () => {
      const { events, store } = await replayTranscript(
        loadTranscript(join(fixtureDirectory, `${scenario}.ndjson`)),
      );
      const live = events.flatMap((event) => (event.type === "turn.completed" ? [event.turn] : []));
      const messages = [...store.sessions.values()].flatMap((session) => session.messages);
      const history = reconstructTurns(messages, [], {
        appThreadId: asAppThreadId(REPLAY_THREAD_ID),
        cwd: "/workspace",
      });
      expect(itemIds(history)).toEqual(itemIds(live));
      if (Object.hasOwn(DERIVED_BOUNDARY_LOSSES, scenario)) {
        expect(history.map(withoutHostIndex)).not.toEqual(live.map(withoutHostIndex));
      } else {
        expect(history.map(withoutHostIndex)).toEqual(live.map(withoutHostIndex));
      }
    });
  }
});
