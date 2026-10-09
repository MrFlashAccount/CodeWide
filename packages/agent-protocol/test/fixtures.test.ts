import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  BOOLEAN_CAPABILITIES,
  OPERATION_NAMES,
  checkMessage,
  supportsCapability,
  type CapabilitySet,
  type OperationName,
} from "../src/v1/index";

interface FixtureEntry {
  readonly respondsTo: OperationName | null;
  readonly message: unknown;
}

interface FixtureFile {
  readonly description: string;
  readonly messages: readonly FixtureEntry[];
}

const fixtureDirectory = join(import.meta.dirname, "..", "fixtures", "v1");
const fixtureNames = readdirSync(fixtureDirectory).filter((name) => name.endsWith(".json"));

function loadFixture(name: string): FixtureFile {
  // WHY: fixture files are JSON owned by this package; `checkMessage` below is
  // the runtime proof of every message shape, so the static type only names
  // the envelope that the test reads.
  return JSON.parse(readFileSync(join(fixtureDirectory, name), "utf8")) as FixtureFile;
}

describe("codewide-agent v1 fixtures", () => {
  it("are present", () => {
    expect(fixtureNames).toEqual(
      expect.arrayContaining(["events.json", "handshake.json", "operations.json"]),
    );
  });

  for (const name of fixtureNames) {
    it(`${name} messages match the v1 shapes and survive a JSON round trip`, () => {
      const fixture = loadFixture(name);
      expect(fixture.messages.length).toBeGreaterThan(0);
      for (const entry of fixture.messages) {
        expect(checkMessage(entry.message, entry.respondsTo)).toEqual([]);
        expect(JSON.parse(JSON.stringify(entry.message))).toEqual(entry.message);
      }
    });
  }

  it("cover every operation request and every event type", () => {
    const messages = fixtureNames.flatMap((name) =>
      loadFixture(name).messages.map((entry) => entry.message),
    );
    const methods = new Set<string>();
    const events = new Set<string>();
    for (const message of messages) {
      if (typeof message !== "object" || message === null) continue;
      const method = (message as { readonly method?: unknown }).method;
      if (method === "event") {
        const type = (message as { readonly params: { readonly type: string } }).params.type;
        events.add(type);
      } else if (typeof method === "string") {
        methods.add(method);
      }
    }
    for (const operation of OPERATION_NAMES) expect(methods).toContain(operation);
    expect([...events].sort()).toEqual(
      [
        "capability.event",
        "diff.updated",
        "item.completed",
        "item.delta",
        "item.started",
        "plan.updated",
        "request.opened",
        "request.resolved",
        "thread.updated",
        "turn.completed",
        "turn.started",
        "usage.updated",
      ].sort(),
    );
  });
});

describe("shape checks reject drift", () => {
  it("reports an undeclared field, a missing field and an unknown variant", () => {
    const base = {
      method: "event",
      params: { type: "diff.updated", appThreadId: "t", turnId: "u", diff: "" },
    };
    expect(checkMessage(base)).toEqual([]);
    expect(checkMessage({ ...base, params: { ...base.params, extra: 1 } })).toEqual([
      "$.params.extra: undeclared field",
    ]);
    expect(
      checkMessage({
        method: "event",
        params: { type: "diff.updated", appThreadId: "t", turnId: "u" },
      }),
    ).toEqual(["$.params.diff: missing"]);
    expect(checkMessage({ method: "event", params: { type: "turn.paused" } })).toEqual([
      "$.params.type: unknown variant turn.paused",
    ]);
  });

  it("requires the answered operation to check a result", () => {
    expect(checkMessage({ id: 1, result: {} })).toEqual([
      "$: a response needs the operation it answers",
    ]);
    expect(checkMessage({ id: 1, result: {} }, "turn.interrupt")).toEqual([]);
  });
});

describe("capability reader", () => {
  const capabilities = {
    ...Object.fromEntries(BOOLEAN_CAPABILITIES.map((name) => [name, false])),
    "turns.steer": true,
    "turns.startWhileActive": "busy",
  } as CapabilitySet; // WHY: built from the exhaustive name list above.

  it("treats a missing extension as a legacy companion with every capability", () => {
    expect(supportsCapability(undefined, "review")).toBe(true);
    expect(supportsCapability(null, "goals")).toBe(true);
  });

  it("reads declared values", () => {
    const extension = { provider: "claude", providerName: "Claude", primary: false, capabilities };
    expect(supportsCapability(extension, "turns.steer")).toBe(true);
    expect(supportsCapability(extension, "review")).toBe(false);
    expect(supportsCapability(extension, "turns.startWhileActive")).toBe(true);
  });
});
