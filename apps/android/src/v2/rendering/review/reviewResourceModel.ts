import type { V2QueryResult } from "@codewide/sync-client/v2";

import type { ReviewFile, ReviewScope } from "./reviewModel";

export function reviewFiles(result: V2QueryResult): ReviewFile[] {
  if (result.kind !== "thread.resources") return [];
  return result.changes.map((change) => ({
    additions: Number(change.additions),
    deletions: Number(change.deletions),
    kind: change.change,
    path: change.path,
  }));
}

export function reviewScopes(result: V2QueryResult, scope: ReviewScope): ReviewScope[] {
  if (result.kind !== "thread.resources") return [scope];
  return result.availableScopes.includes(scope)
    ? result.availableScopes
    : [scope, ...result.availableScopes];
}
