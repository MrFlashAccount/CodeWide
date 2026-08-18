import { describe, expect, it } from "vitest";

import { humanPairingError } from "../src/data/pairing-error";

describe("humanPairingError", () => {
  it("does not misclassify native pairing network failures as consumed codes", () => {
    expect(humanPairingError(new Error("Secure pairing connection failed"))).toBe(
      "Could not reach the host. The one-time code was not consumed; check the connection and retry.",
    );
  });

  it("keeps rejected pairing codes distinct from transport failures", () => {
    expect(humanPairingError(new Error("Pairing failed (401). Generate a fresh one-time token on the host."))).toBe(
      "This connection code is invalid or has already been used.",
    );
  });
});
