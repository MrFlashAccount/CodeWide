import { describe, expect, it } from "vitest";
import { changeScopeDisplay } from "../src/rendering/changeScopeDisplay";

describe("Changes scope display", () => {
  it("shows the current branch reported by the exact VCS snapshot", () => {
    expect(changeScopeDisplay("branch", { branch: "feature/current", provider: "git" })).toEqual({
      icon: "git-branch-outline",
      title: "feature/current",
    });
  });

  it("bounds long branch names by removing only their middle", () => {
    const maximumLengthBranch = `feature/${"x".repeat(56)}`;
    const branch = `feature/${"middle/".repeat(12)}recognizable-tail`;
    const title = changeScopeDisplay("branch", { branch, provider: "git" }).title;

    expect(
      changeScopeDisplay("branch", { branch: maximumLengthBranch, provider: "git" }).title,
    ).toBe(maximumLengthBranch);
    expect(title).toHaveLength(64);
    expect(title).toMatch(/^feature\//u);
    expect(title).toContain("…");
    expect(title).toMatch(/recognizable-tail$/u);
  });

  it("keeps the generic label when the snapshot has no branch identity", () => {
    expect(changeScopeDisplay("branch", { branch: null, provider: "git" }).title).toBe("Branch");
  });
});
