import { describe, expect, it } from "vitest";
import { cargoPackageOf, packageArguments } from "../../../scripts/ci-rust";

describe("ci-rust", () => {
  it("reads the cargo package a check command lints", () => {
    expect(cargoPackageOf("cargo clippy -p codewide-companion --all-targets --all-features -- -D warnings")).toBe(
      "codewide-companion",
    );
    expect(cargoPackageOf("./scripts/validate-boundaries.sh")).toBeUndefined();
  });

  it("selects each package once in a stable order", () => {
    expect(packageArguments(["companion-core", "agent-core", "companion-core"])).toEqual([
      "-p",
      "agent-core",
      "-p",
      "companion-core",
    ]);
  });
});
