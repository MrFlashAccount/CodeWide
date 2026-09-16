import { describe, expect, it } from "vitest";

import config from "../oxlint.v1.config.mjs";

describe("V1 React Doctor scope", () => {
  it("checks TSX and hook-bearing TypeScript without analyzing ordinary TypeScript", () => {
    const typeScriptOverride = config.overrides.find(
      (override) =>
        override.files.length === 2 &&
        override.files.includes("app/v1/**/*.ts") &&
        override.files.includes("src/**/*.ts"),
    );
    const hookOverride = config.overrides.find((override) =>
      override.files.includes("src/features/projects/projectPickerSession.ts"),
    );

    expect(typeScriptOverride?.rules["react-doctor/async-await-in-loop"]).toBe("off");
    expect(hookOverride?.rules["react-doctor/no-adjust-state-on-prop-change"]).toBe("error");
    expect(hookOverride?.files).not.toContain("src/native/ordered-projection-gate.ts");
  });
});
