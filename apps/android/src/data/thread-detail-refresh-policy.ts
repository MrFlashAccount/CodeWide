/**
 * Terminal invalidations already carry enough summary data for the thread list.
 * Only the retained conversation needs the heavier authoritative detail read;
 * every other thread is refreshed when it becomes retained.
 */
export function shouldRepairThreadDetail(
  desiredThreadId: string | undefined,
  candidateThreadId: string,
): boolean {
  return desiredThreadId === candidateThreadId;
}

/** Live completion is already projected; rollout invalidation owns fallback repair. */
export function threadPatchRequiresAuthoritativeRefresh(operationKind: string): boolean {
  return operationKind === "threadInvalidated";
}
