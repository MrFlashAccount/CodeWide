import { readFileSync } from "node:fs";

export const mainConversationHeader = readFileSync(
  new URL("../../src/features/conversation/header/ConversationHeader.tsx", import.meta.url),
  "utf8",
);
