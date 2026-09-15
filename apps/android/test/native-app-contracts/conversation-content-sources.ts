import { readFileSync } from "node:fs";

export const ownerAgentResponseMarkdown = readFileSync(
  new URL("../../src/features/conversation/content/AgentResponseMarkdown.tsx", import.meta.url),
  "utf8",
);
