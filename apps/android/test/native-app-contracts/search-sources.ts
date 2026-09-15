import { readFileSync } from "node:fs";

export const threadSearch = readFileSync(
  new URL("../../src/features/search/threadSearch.ts", import.meta.url),
  "utf8",
);
