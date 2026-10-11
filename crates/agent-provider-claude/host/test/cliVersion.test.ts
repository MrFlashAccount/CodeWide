import { describe, expect, it } from "vitest";
import { parseClaudeVersion, readClaudeVersion } from "../src/claude/cliVersion.js";

describe("Claude CLI version", () => {
  it("extracts the semantic version from the human-readable CLI output", () => {
    expect(parseClaudeVersion("2.1.111 (Claude Code)\n")).toBe("2.1.111");
    expect(parseClaudeVersion("Claude Code v2.2.0-beta.1\n")).toBe("2.2.0-beta.1");
  });

  it("rejects output without a version", () => {
    expect(() => parseClaudeVersion("Claude Code\n")).toThrow(
      "claude --version did not report a semantic version",
    );
    expect(() => parseClaudeVersion(`2.1.0-${"a".repeat(65)}`)).toThrow(
      "claude --version did not report a semantic version",
    );
  });

  it("reads a version from an executable", async () => {
    await expect(readClaudeVersion(process.execPath)).resolves.toMatch(/^\d+\.\d+\.\d+/);
  });
});
