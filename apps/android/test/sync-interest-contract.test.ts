import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

import { HIGH_FREQUENCY_SUMMARY_PATCHES } from "../src/data/thread-summary-projection";

function readSyncInterestContract(): unknown {
  const contractPath = resolve(
    import.meta.dirname,
    "../../../crates/companion-core/contract/v1.json",
  );
  const contractValue: unknown = JSON.parse(readFileSync(contractPath, "utf8"));
  if (contractValue === null || typeof contractValue !== "object" || Array.isArray(contractValue)) {
    throw new Error("Companion V1 contract is invalid");
  }
  return "syncInterest" in contractValue ? contractValue.syncInterest : null;
}

function readKotlinInterestLimits(): Map<string, number> {
  const kotlin = readFileSync(
    resolve(
      import.meta.dirname,
      "../android/app/src/main/java/dev/codewide/app/remote/NativeSyncInterest.kt",
    ),
    "utf8",
  );
  const owner = /internal object NativeSyncInterest \{(?<body>[^}]*)/u.exec(kotlin)?.groups?.body;
  if (owner === undefined) {
    throw new Error("Kotlin NativeSyncInterest owner was not found");
  }
  const limits = new Map<string, number>();
  for (const match of owner.matchAll(/const val ([A-Z_]+) = ([0-9_]+)/gu)) {
    const name = match[1];
    const value = match[2];
    if (name === undefined || value === undefined) {
      throw new Error("Kotlin limit parser returned an incomplete match");
    }
    limits.set(name, Number(value.replaceAll("_", "")));
  }
  return limits;
}

// Protects the paired-release contract: Companion filters by these kinds and
// bounds, so the device summary and native validation must use the same values.
describe("sync interest contract", () => {
  it("matches the device high-frequency kinds and native interest limits", () => {
    const contract = readSyncInterestContract();
    expect(contract).toMatchObject({
      maxInterestThreads: expect.any(Number),
      maxThreadIdChars: expect.any(Number),
      threadTopicKinds: expect.any(Array),
    });
    if (
      contract === null ||
      typeof contract !== "object" ||
      !("threadTopicKinds" in contract) ||
      !("maxInterestThreads" in contract) ||
      !("maxThreadIdChars" in contract) ||
      !Array.isArray(contract.threadTopicKinds)
    ) {
      throw new Error("Companion syncInterest contract is invalid");
    }
    expect(HIGH_FREQUENCY_SUMMARY_PATCHES).toEqual(new Set(contract.threadTopicKinds));
    expect(readKotlinInterestLimits()).toEqual(
      new Map([
        ["MAX_INTEREST_THREADS", contract.maxInterestThreads],
        ["MAX_INTEREST_THREAD_ID_CHARS", contract.maxThreadIdChars],
      ]),
    );
  });
});
