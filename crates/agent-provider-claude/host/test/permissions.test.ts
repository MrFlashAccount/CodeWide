/**
 * Permission profiles and canUseTool decision mapping (fail-closed rules).
 */

import { describe, expect, it } from "vitest";
import {
  approvalDecision,
  approvalTitle,
  normalizeAnswer,
  sessionScoped,
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
      expect(profileOptions(profile)).toMatchObject({
        permissionMode: "bypassPermissions",
        allowDangerouslySkipPermissions: true,
      });
    }
  });
});

describe("approval decisions", () => {
  const input = { command: "pnpm test" };
  const suggestions = [
    {
      type: "addRules",
      rules: [{ toolName: "Bash", ruleContent: "pnpm test" }],
      behavior: "allow",
      destination: "localSettings",
    },
    { type: "setMode", mode: "acceptEdits", destination: "session" },
  ];

  it("maps accept, acceptForSession, decline and cancel", () => {
    expect(
      approvalDecision({ type: "approval", decision: "accept" }, { input, toolUseId: "t" }),
    ).toEqual({
      behavior: "allow",
      scope: "once",
      toolUseID: "t",
      updatedInput: input,
    });
    expect(
      approvalDecision(
        { type: "approval", decision: "acceptForSession" },
        { input, toolUseId: "t" },
      ),
    ).toMatchObject({ behavior: "allow", scope: "session" });
    expect(
      approvalDecision({ type: "approval", decision: "decline" }, { input, toolUseId: "t" }),
    ).toMatchObject({
      behavior: "deny",
      interrupt: false,
    });
    expect(
      approvalDecision({ type: "approval", decision: "cancel" }, { input, toolUseId: "t" }),
    ).toMatchObject({
      behavior: "deny",
      interrupt: true,
    });
  });

  it("never allows on an error or a mismatched response", () => {
    expect(
      approvalDecision({ type: "error", message: "x" }, { input, toolUseId: "t" }).behavior,
    ).toBe("deny");
    expect(
      approvalDecision({ type: "userInput", answers: {} }, { input, toolUseId: "t" }).behavior,
    ).toBe("deny");
    expect(
      userInputDecision(
        { type: "approval", decision: "accept" },
        { input: {}, questions: [], toolUseId: "t" },
      ).behavior,
    ).toBe("deny");
  });

  it("never writes settings files for acceptForSession", () => {
    expect(sessionScoped(suggestions).map((update) => update.destination)).toEqual([
      "session",
      "session",
    ]);
    expect(sessionScoped([{ destination: "projectSettings", type: "addRules" }])).toEqual([
      { destination: "session", type: "addRules" },
    ]);
  });

  it("titles describe what is approved", () => {
    expect(approvalTitle("Bash", { command: "ls" }, { cwd: "/w", mcpServers: [] })).toBe("Run ls");
    expect(approvalTitle("Edit", { file_path: "/w/src/a.ts" }, { cwd: "/w", mcpServers: [] })).toBe(
      "Edit src/a.ts",
    );
    expect(approvalTitle("Write", { file_path: "/etc/x" }, { cwd: "/w", mcpServers: [] })).toBe(
      "Write /etc/x",
    );
    expect(approvalTitle("WebFetch", { url: "https://e.com" }, { cwd: "/w", mcpServers: [] })).toBe(
      "Fetch https://e.com",
    );
    expect(approvalTitle("mcp__notes__write_note", {}, { cwd: "/w", mcpServers: ["notes"] })).toBe(
      "Use notes · write_note",
    );
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
      { input, questions, toolUseId: "t" },
    );
    expect(decision.behavior === "allow" ? decision.updatedInput["answers"] : null).toEqual({
      "Which runner?": "vitest",
      "Name?": "Ada",
    });
  });
});
