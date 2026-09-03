import type { SyncV2Session, V2Query, V2QueryResult } from "@codewide/sync-client/v2";

import { correlateQueryResult } from "./queryCorrelation";

type ThreadResourcesQuery = Extract<V2Query, { kind: "thread.resources" }>;
type ThreadResourcesResult = Extract<V2QueryResult, { kind: "thread.resources" }>;

const PAGE_SIZE = 100;
const MAX_PAGES = 10_000;

/** Materializes every opaque page into the single authoritative resource value
 * consumed by the attachment, changes, review, and conversation surfaces. */
export async function readAllThreadResources(
  session: SyncV2Session,
  query: ThreadResourcesQuery,
): Promise<ThreadResourcesResult> {
  const changes: ThreadResourcesResult["changes"] = [];
  const attachments: ThreadResourcesResult["attachments"] = [];
  let cursor = query.cursor;
  let first: ThreadResourcesResult | null = null;
  const visited = new Set<string | null>();
  for (let page = 0; page < MAX_PAGES; page += 1) {
    if (visited.has(cursor)) throw new Error("Thread resources returned a repeated cursor");
    visited.add(cursor);
    const pageQuery: ThreadResourcesQuery = {
      cursor,
      kind: "thread.resources",
      limit: PAGE_SIZE,
      scope: query.scope,
      threadId: query.threadId,
    };
    const result = correlateQueryResult(pageQuery, await session.query(pageQuery));
    if (result.threadId !== query.threadId) {
      throw new Error("Unexpected thread resources response");
    }
    if (first !== null && result.revision !== first.revision) {
      throw new Error("Thread resources changed while their pages were being read");
    }
    first ??= result;
    changes.push(...result.changes);
    attachments.push(...result.attachments);
    cursor = result.next;
    if (cursor === null) return { ...first, attachments, changes, next: null };
  }
  throw new Error("Thread resource pagination exceeded its safety bound");
}
