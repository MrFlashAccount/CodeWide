import { readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

import { compactSource } from "./source-contract";

const screen = compactSource(
  readFileSync(new URL("../app/v1/_layout.tsx", import.meta.url), "utf8"),
);

const ownerTurnProjection = compactSource(readFileSync(new URL("../src/features/conversation/turns/turnProjection.ts", import.meta.url), "utf8"));
const ownerTurnTimelineItem = compactSource(readFileSync(new URL("../src/features/conversation/turns/TurnTimelineItem.tsx", import.meta.url), "utf8"));

const ownerAgentTurnBody = compactSource(readFileSync(new URL("../src/features/conversation/turns/AgentTurnBody.tsx", import.meta.url), "utf8"));

describe("empty agent response", () => {
  it("distinguishes a generated response from an empty projected block", () => {
    expect(ownerTurnProjection).toContain(
      'const hasGeneratedAgentResponse = (latestAgentBlock?.body ?? "").trim().length > 0 || (latestAgentTextReference?.byteLength ?? 0) > 0;',
    );
    expect(ownerAgentTurnBody).toContain(
      "latestAgentBlock !== null && presentation.hasGeneratedAgentResponse && ( <AgentResponseMarkdown",
    );
  });

  it("uses stable terminal empty-state copy", () => {
    expect(ownerAgentTurnBody).toContain("rawTurn.status === \"interrupted\" ? \"Stopped before response was generated\" : \"No response was generated\"");
    expect(screen).not.toContain("Completed without final response");
    expect(screen).not.toContain("Stopped before a response was completed.");
  });
});
