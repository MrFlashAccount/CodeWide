import { readFileSync } from "node:fs";

export const migratedChangesFeature = readFileSync(
  new URL("../../src/features/changes/ChangesFeature.tsx", import.meta.url),
  "utf8",
);
export const migratedThreadResourceContextChips = readFileSync(
  new URL("../../src/features/changes/ThreadResourceContextChips.tsx", import.meta.url),
  "utf8",
);
