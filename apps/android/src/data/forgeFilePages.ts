import {
  experimental_streamedQuery as streamedQuery,
  skipToken,
  type QueryFunction,
  type UseQueryOptions,
} from "@tanstack/react-query";

import { ForgeContractViolation } from "./forgeErrors";
import type { PullRequestFilesPage } from "./forgeMutationContract";
import type { ForgeResources } from "./forgeResources";

type Files = ForgeResources["files"];
type FilesTarget = Parameters<Files["keyOf"]>[0];

/** The revision and first continuation cursor identify the remaining files of this PR. */
export function remainingFileOptions(
  files: Files,
  target: FilesTarget,
  first: PullRequestFilesPage | null,
): UseQueryOptions<PullRequestFilesPage> {
  const root = files.options(target);
  const cursor = first?.nextCursor ?? null;
  return {
    gcTime: root.gcTime,
    // Continuations can contain every patch in a large PR. Keep only the first page on disk.
    meta: { persist: false },
    queryFn:
      first === null || cursor === null
        ? skipToken
        : remainingFiles(files, target, { cursor, page: first }),
    queryKey: [...root.queryKey, "remaining", cursor],
    retry: false,
    staleTime: (query) => (query.state.data?.nextCursor === null ? Infinity : 0),
  };
}

/** Merges provider pages by path, preserving their order and any reported provider limit. */
export function appendFiles(
  current: PullRequestFilesPage,
  next: PullRequestFilesPage,
): PullRequestFilesPage {
  const paths = new Set(current.files.map((file) => file.path));
  return {
    ...next,
    files: [...current.files, ...next.files.filter((file) => !paths.has(file.path))],
    truncated: next.truncated ?? current.truncated,
  };
}

/** A cancelled or failed tail resumes at its first missing page. A refresh replaces a completed tail atomically. */
function remainingFiles(
  files: Files,
  target: FilesTarget,
  start: { readonly cursor: string; readonly page: PullRequestFilesPage },
): QueryFunction<PullRequestFilesPage> {
  return async (context) => {
    const cached = context.client.getQueryData<PullRequestFilesPage>(context.queryKey);
    const resume = cached?.nextCursor ?? start.cursor;
    return streamedQuery({
      initialValue: { ...start.page, files: [] },
      reducer: appendFiles,
      refetchMode: cached?.nextCursor === null ? "replace" : "append",
      async *streamFn({ signal }) {
        const seen = new Set<string>();
        let cursor: string | null = resume;
        while (cursor !== null && !signal.aborted) {
          seen.add(cursor);
          const page: PullRequestFilesPage = await files.options({ ...target, cursor }).queryFn();
          if (
            page.headRevision !== target.headRevision ||
            (page.nextCursor !== null && seen.has(page.nextCursor))
          ) {
            throw new ForgeContractViolation("files pagination");
          }
          yield page;
          cursor = page.nextCursor;
        }
      },
    })(context);
  };
}
