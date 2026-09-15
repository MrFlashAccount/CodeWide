import { useLiveQuery } from "@tanstack/react-db";
import type { PendingRequestDatabase } from "../../data/pending-request-database";
/** Publishes server requests in their existing creation order. */
export function usePendingRequests(database: PendingRequestDatabase | null) {
  const pendingRequestQuery = useLiveQuery(() => database?.collection, [database]);
  const pendingRequests = [...(pendingRequestQuery.data ?? [])].sort(
    (left, right) => left.createdAt - right.createdAt,
  );

  return pendingRequests;
}
