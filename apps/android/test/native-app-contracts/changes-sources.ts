import { readFileSync } from "node:fs";

export const migratedChangesFeature = [
  "../../src/features/changes/ChangesFeature.tsx",
  "../../src/features/changes/RouteChangesWorkspace.tsx",
  "../../src/features/changes/RouteCodeDocumentReview.tsx",
]
  .map((path) => readFileSync(new URL(path, import.meta.url), "utf8"))
  .join("\n");
export const migratedThreadResourceContextChips = readFileSync(
  new URL("../../src/features/changes/ThreadResourceContextChips.tsx", import.meta.url),
  "utf8",
);
