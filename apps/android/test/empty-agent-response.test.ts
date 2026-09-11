import { readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

import { compactSource } from "./source-contract";

const screen = compactSource(
  readFileSync(new URL("../src/CodeWideScreen.tsx", import.meta.url), "utf8"),
);

describe("empty agent response", () => {
  it("distinguishes a generated response from an empty projected block", () => {
    expect(screen).toContain(
      'const hasGeneratedAgentResponse = (latestAgentBlock?.body ?? "").trim().length > 0 || (latestAgentTextReference?.byteLength ?? 0) > 0;',
    );
    expect(screen).toContain(
      'latestAgentBlock !== null && hasGeneratedAgentResponse && ( <AgentResponseMarkdown',
    );
  });

  it("uses stable terminal empty-state copy", () => {
    expect(screen).toContain('rawTurn.status === "interrupted" ? "Stopped before response was generated" : "No response was generated"');
    expect(screen).not.toContain("Completed without final response");
    expect(screen).not.toContain("Stopped before a response was completed.");
  });
});
