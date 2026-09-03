import type { V2Query, V2QueryResult } from "@codewide/sync-client/v2";
import { describe, expect, it } from "vitest";

import {
  correlateQueryResult,
  QueryProtocolError,
} from "../src/v2/application/resources/queryCorrelation";

const QUERY_MATRIX: Record<V2Query["kind"], V2Query> = {
  "accounts.list": { kind: "accounts.list" },
  "capabilities.read": { kind: "capabilities.read" },
  "catalog.page": { before: null, kind: "catalog.page", limit: 1, partition: "active" },
  "catalog.search": {
    cursor: null,
    kind: "catalog.search",
    limit: 1,
    partition: "active",
    text: "query",
  },
  "history.page": {
    cursor: null,
    detail: "summary",
    direction: "older",
    kind: "history.page",
    limit: 1,
    threadId: "thread",
  },
  "item.output": {
    cursor: null,
    itemId: "item",
    kind: "item.output",
    limitBytes: 1,
    threadId: "thread",
    turnId: "turn",
  },
  "models.list": { kind: "models.list" },
  "operation.get": { kind: "operation.get", operationId: "operation" },
  "projects.list": { kind: "projects.list" },
  "queue.list": { cursor: null, kind: "queue.list", limit: 1, threadId: null },
  "skills.list": { forceReload: false, kind: "skills.list", workspace: "/workspace" },
  "thread.agents": { cursor: null, kind: "thread.agents", limit: 1, threadId: "thread" },
  "thread.change": {
    kind: "thread.change",
    path: "file.ts",
    scope: "session",
    threadId: "thread",
  },
  "thread.changeOutput": {
    cursor: null,
    kind: "thread.changeOutput",
    limitBytes: 1,
    path: "file.ts",
    scope: "session",
    threadId: "thread",
  },
  "thread.goal": { kind: "thread.goal", threadId: "thread" },
  "thread.processes": { cursor: null, kind: "thread.processes", limit: 1, threadId: "thread" },
  "thread.resources": {
    cursor: null,
    kind: "thread.resources",
    limit: 1,
    scope: "session",
    threadId: "thread",
  },
  "turn.items": {
    cursor: null,
    kind: "turn.items",
    limit: 1,
    threadId: "thread",
    turnId: "turn",
  },
  "workspace.file": { kind: "workspace.file", path: "file.ts", threadId: "thread" },
  "workspace.inspect": { kind: "workspace.inspect", path: "/workspace" },
};

describe("V2 query result correlation", () => {
  it("rejects a wrong result kind for every query kind", () => {
    for (const query of Object.values(QUERY_MATRIX)) {
      const wrongResult = wrongResultFor(query);
      expect(() => correlateQueryResult(query, wrongResult)).toThrow(
        new QueryProtocolError(query.kind, wrongResult.kind),
      );
    }
  });

  it("preserves the result type selected by the query", () => {
    const result = correlateQueryResult(
      { kind: "models.list" },
      { kind: "models.list", models: [] },
    );

    expect(result.models).toEqual([]);
  });
});

function wrongResultFor(query: V2Query): V2QueryResult {
  if (query.kind === "models.list") {
    return { activeProfileId: null, allExhausted: false, kind: "accounts.list", profiles: [] };
  }
  return { kind: "models.list", models: [] };
}
