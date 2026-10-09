/**
 * Fixture replay: every Claude transcript through the real thread service.
 *
 * Contract checked per scenario: valid v1 events (agent-protocol shape
 * check), the neutral turn ordering rules, no prompt text in logs, and the
 * neutral event stream equal to the committed golden file
 * `test/golden/<scenario>.neutral.jsonl` (regenerate with UPDATE_GOLDEN=1).
 * The Rust client-wire projector consumes these golden files.
 */

import { readdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { checkEvent } from "@codewide/agent-protocol";
import { loadTranscript, replayTranscript } from "./support/replay.js";
import { turnViolations } from "./support/invariants.js";

const fixtureDirectory = join(import.meta.dirname, "fixtures");
const goldenDirectory = join(import.meta.dirname, "golden");
const scenarios = readdirSync(fixtureDirectory)
  .filter((name) => name.endsWith(".ndjson"))
  .map((name) => name.slice(0, -".ndjson".length))
  .sort();

describe("transcript replay", () => {
  it("covers the copied fixtures and our own recordings", () => {
    expect(scenarios.length).toBeGreaterThanOrEqual(32);
  });

  it("replaces a lost session once, with a bounded history prefix", async () => {
    const { events, opens, offers } = await replayTranscript(loadTranscript(join(fixtureDirectory, "codewide_lost_session.ndjson")));
    expect(opens.map((open) => open.identity.type)).toEqual(["new", "resume", "new"]);
    expect(opens[2]?.identity.sessionId).not.toEqual(opens[0]?.identity.sessionId);
    const replacement = offers.at(-1)?.content[0];
    expect(replacement?.type === "text" ? replacement.text : "").toContain("[Historical conversation from this thread]\nUser: Remember the codeword\nClaude: Noted.");
    const completions = events.filter((event) => event.type === "turn.completed");
    expect(completions.map((event) => (event.type === "turn.completed" ? event.turn.status : null))).toEqual(["completed", "completed"]);
  });

  it("fails only the active turn when the Claude process exits", async () => {
    const { events } = await replayTranscript(loadTranscript(join(fixtureDirectory, "codewide_process_exit.ndjson")));
    const completed = events.find((event) => event.type === "turn.completed");
    expect(completed?.type === "turn.completed" ? completed.turn.error : null).toEqual({
      kind: "processExited",
      message: "Claude process exited unexpectedly",
    });
    expect(completed?.type === "turn.completed" ? completed.turn.items.map((item) => ("status" in item ? item.status : null)) : []).toEqual([
      null,
      "failed",
    ]);
  });

  for (const scenario of scenarios) {
    it(scenario, async () => {
      const entries = loadTranscript(join(fixtureDirectory, `${scenario}.ndjson`));
      const { events, logs } = await replayTranscript(entries);

      for (const event of events) {
        const errors: string[] = [];
        checkEvent(event, "$", errors);
        expect(errors).toEqual([]);
      }
      expect(turnViolations(events)).toEqual([]);
      expect(events.some((event) => event.type === "turn.completed")).toBe(true);

      const prompts = entries.flatMap((entry) => entry.metadata?.prompts ?? []).filter((prompt) => prompt.length > 12);
      for (const line of logs) for (const prompt of prompts) expect(line.includes(prompt)).toBe(false);

      const stream = `${events.map((event) => JSON.stringify(event)).join("\n")}\n`;
      const goldenPath = join(goldenDirectory, `${scenario}.neutral.jsonl`);
      if (process.env["UPDATE_GOLDEN"] === "1") {
        writeFileSync(goldenPath, stream);
      }
      expect(stream).toEqual(readFileSync(goldenPath, "utf8"));
    });
  }
});
