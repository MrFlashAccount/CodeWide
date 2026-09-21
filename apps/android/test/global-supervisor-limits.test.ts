import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

import { globalSupervisorLimitsV1 } from "../src/data/globalSupervisorLimitsV1";

describe("GlobalSupervisorLimitsV1", () => {
  it("matches the Companion contract and Kotlin generated surface", () => {
    const contractPath = resolve(
      import.meta.dirname,
      "../../../crates/companion-core/contract/v1.json",
    );
    const contractValue: unknown = JSON.parse(readFileSync(contractPath, "utf8"));
    if (
      contractValue === null ||
      typeof contractValue !== "object" ||
      Array.isArray(contractValue)
    ) {
      throw new Error("Companion V1 contract is invalid");
    }
    const contract =
      "globalSupervisorLimitsV1" in contractValue ? contractValue.globalSupervisorLimitsV1 : null;
    expect(globalSupervisorLimitsV1).toEqual(contract);

    const kotlin = readFileSync(
      resolve(
        import.meta.dirname,
        "../android/app/src/main/java/dev/codewide/app/remote/GlobalSupervisorLimitsV1.kt",
      ),
      "utf8",
    );
    const kotlinFields = new Map<string, number>();
    for (const match of kotlin.matchAll(/const val ([A-Z_]+) = ([0-9_]+)/gu)) {
      const name = match[1];
      const value = match[2];
      if (name === undefined || value === undefined) {
        throw new Error("Kotlin limit parser returned an incomplete match");
      }
      kotlinFields.set(name, Number(value.replaceAll("_", "")));
    }
    const expectedFields = new Map(
      Object.entries(globalSupervisorLimitsV1).map(([name, value]) => [
        name.replaceAll(/[A-Z]/gu, (letter) => `_${letter}`).toUpperCase(),
        value,
      ]),
    );
    expect(kotlinFields).toEqual(expectedFields);
  });
});
