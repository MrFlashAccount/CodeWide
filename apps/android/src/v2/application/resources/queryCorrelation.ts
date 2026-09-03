import type { V2Query, V2QueryResult } from "@codewide/sync-client/v2";

export type QueryResultFor<Q extends V2Query> = Extract<V2QueryResult, { kind: Q["kind"] }>;

export class QueryProtocolError extends Error {
  constructor(expectedKind: V2Query["kind"], receivedKind: V2QueryResult["kind"]) {
    super(`Protocol error: expected ${expectedKind} query result, received ${receivedKind}`);
    this.name = "QueryProtocolError";
  }
}

export function correlateQueryResult<Q extends V2Query>(
  query: Q,
  result: V2QueryResult,
): QueryResultFor<Q> {
  if (!queryResultMatches(query, result)) {
    throw new QueryProtocolError(query.kind, result.kind);
  }
  return result;
}

function queryResultMatches<Q extends V2Query>(
  query: Q,
  result: V2QueryResult,
): result is QueryResultFor<Q> {
  return result.kind === query.kind;
}

export function queryResultHasKind<K extends V2QueryResult["kind"]>(
  result: V2QueryResult,
  kind: K,
): result is Extract<V2QueryResult, { kind: K }> {
  return result.kind === kind;
}
