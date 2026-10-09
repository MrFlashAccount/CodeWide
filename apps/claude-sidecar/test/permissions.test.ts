/**
 * Permission profiles and canUseTool decision mapping (fail-closed rules).
 */

import { describe, expect, it } from "vitest";
import {
  approvalDecision,
  approvalTitle,
  normalizeAnswer,
  sessionScopedUpdates,
  userInputDecision,
  userInputQuestions,
} from "../src/permissions/approvals.js";
import { profileOptions } from "../src/permissions/profiles.js";

describe("profiles", () => {
  it("fix the security-relevant query options per profile", () => {
    expect(profileOptions(":read-only")).toMatchObject({
      permissionMode: "default",
      settingSources: [],
      strictMcpConfig: true,
      mcpServers: {},
      tools: ["Read", "Glob", "Grep", "LS"],
      allowDangerouslySkipPermissions: false,
    });
    expect(profileOptions(":workspace")).toMatchObject({
      permissionMode: "acceptEdits",
      settingSources: ["user", "project", "local"],
      allowDangerouslySkipPermissions: false,
    });
    for (const profile of [":full-access", ":danger-full-access"] as const) {
      expect(profileOptions(profile)).toMatchObject({ permissionMode: "bypassPermissions", allowDangerouslySkipPermissions: true });
    }
  });
});

describe("approval decisions", () => {
  const input = { command: "pnpm test" };
  const suggestions = [
    { type: "addRules", rules: [{ toolName: "Bash", ruleContent: "pnpm test" }], behavior: "allow", destination: "localSettings" },
    { type: "setMode", mode: "acceptEdits", destination: "session" },
  ];

  it("maps accept, acceptForSession, decline and cancel", () => {
    expect(approvalDecision({ type: "approval", decision: "accept" }, input, suggestions, "t")).toEqual({
      behavior: "allow",
      updatedInput: input,
      updatedPermissions: null,
      toolUseID: "t",
    });
    const forSession = approvalDecision({ type: "approval", decision: "acceptForSession" }, input, suggestions, "t");
    expect(forSession.behavior === "allow" ? forSession.updatedPermissions?.map((update) => update.destination) : null).toEqual([
      "session",
      "session",
    ]);
    expect(approvalDecision({ type: "approval", decision: "decline" }, input, suggestions, "t")).toMatchObject({
      behavior: "deny",
      interrupt: false,
    });
    expect(approvalDecision({ type: "approval", decision: "cancel" }, input, suggestions, "t")).toMatchObject({
      behavior: "deny",
      interrupt: true,
    });
  });

  it("never allows on an error or a mismatched response", () => {
    expect(approvalDecision({ type: "error", message: "x" }, input, suggestions, "t").behavior).toBe("deny");
    expect(approvalDecision({ type: "userInput", answers: {} }, input, suggestions, "t").behavior).toBe("deny");
    expect(userInputDecision({ type: "approval", decision: "accept" }, {}, [], "t").behavior).toBe("deny");
  });

  it("never writes settings files for acceptForSession", () => {
    expect(sessionScopedUpdates([{ type: "addRules", destination: "projectSettings" }, "junk"])).toEqual([
      { type: "addRules", destination: "session" },
    ]);
  });

  it("titles describe what is approved", () => {
    expect(approvalTitle("Bash", { command: "ls" }, "/w", [])).toBe("Run ls");
    expect(approvalTitle("Edit", { file_path: "/w/src/a.ts" }, "/w", [])).toBe("Edit src/a.ts");
    expect(approvalTitle("Write", { file_path: "/etc/x" }, "/w", [])).toBe("Write /etc/x");
    expect(approvalTitle("WebFetch", { url: "https://e.com" }, "/w", [])).toBe("Fetch https://e.com");
    expect(approvalTitle("mcp__notes__write_note", {}, "/w", ["notes"])).toBe("Use notes · write_note");
  });
});

describe("user input", () => {
  const input = {
    questions: [
      {
        question: "Which runner?",
        header: "Runner",
        multiSelect: true,
        options: [
          { label: "vitest", description: "Unit" },
          { label: "playwright", description: "E2E" },
        ],
      },
      { question: "Name?", header: "Name", multiSelect: false, options: [] },
    ],
  };

  it("maps a comma-separated custom answer onto option labels", () => {
    const [runner] = userInputQuestions(input);
    if (runner === undefined) throw new Error("question missing");
    expect(normalizeAnswer(runner, ["VITEST,  Playwright"])).toBe("vitest, playwright");
    expect(normalizeAnswer(runner, ["vitest, something else"])).toBe("vitest, something else");
  });

  it("answers the SDK by question text", () => {
    const questions = userInputQuestions(input);
    const decision = userInputDecision(
      { type: "userInput", answers: { q0: { answers: ["vitest"] }, q1: { answers: ["Ada"] } } },
      input,
      questions,
      "t",
    );
    expect(decision.behavior === "allow" ? decision.updatedInput["answers"] : null).toEqual({ "Which runner?": "vitest", "Name?": "Ada" });
  });
});
