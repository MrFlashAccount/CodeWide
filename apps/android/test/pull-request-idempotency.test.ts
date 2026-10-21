import { describe, expect, it } from "vitest";

import type { ForgeFailure } from "../src/data/forgeErrors";
import { createIdempotencyKeys } from "../src/features/pullRequestDetail/actions/idempotencyKeys";

function failure(kind: ForgeFailure["kind"]): ForgeFailure {
  return { kind, message: kind };
}

describe("idempotency keys", () => {
  it("reuses a key only after the companion could not be reached", () => {
    let next = 0;
    const keys = createIdempotencyKeys(() => `key-${String((next += 1))}`);
    const first = keys.keyFor("merge");
    keys.settle("merge", failure("unreachable"));
    expect(keys.keyFor("merge")).toBe(first);
  });

  it("retires the key after outcomeUnknown so the refreshed run uses a new one", () => {
    let next = 0;
    const keys = createIdempotencyKeys(() => `key-${String((next += 1))}`);
    const first = keys.keyFor("submit");
    keys.settle("submit", failure("unreachable"));
    expect(keys.keyFor("submit")).toBe(first);
    keys.settle("submit", failure("outcomeUnknown"));
    const second = keys.keyFor("submit");
    expect(second).not.toBe(first);
    keys.settle("submit", null);
    expect(keys.keyFor("submit")).not.toBe(second);
  });

  it("keeps intents apart", () => {
    let next = 0;
    const keys = createIdempotencyKeys(() => `key-${String((next += 1))}`);
    expect(keys.keyFor("merge")).not.toBe(keys.keyFor("close"));
  });
});
