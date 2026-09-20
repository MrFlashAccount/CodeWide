type TimelineIdentityItem = { clientId?: unknown; type?: unknown };

const RETAINED_REMOTE_KEY_LIMIT = 2048;
const retainedRemoteKeys = new Map<string, string>();

export function optimisticTimelineKey(scope: string, clientId: string): string {
  return `turn-client:${scope}:${clientId}`;
}

export function remoteTurnTimelineKey(
  scope: string,
  turnId: string,
  items: readonly TimelineIdentityItem[],
): string {
  const clientId = items.find(
    (item) => item.type === "userMessage" && typeof item.clientId === "string",
  )?.clientId;
  return typeof clientId === "string" && clientId.length > 0
    ? optimisticTimelineKey(scope, clientId)
    : `turn-remote:${scope}:${turnId}`;
}

/** A pre-turn server row keeps its first list identity when the user message arrives later. */
export function retainedRemoteTurnTimelineKey(
  scope: string,
  turnId: string,
  items: readonly TimelineIdentityItem[],
): string {
  const identity = `${scope}\u0000${turnId}`;
  const retained = retainedRemoteKeys.get(identity);
  if (retained !== undefined) {
    retainedRemoteKeys.delete(identity);
    retainedRemoteKeys.set(identity, retained);
    return retained;
  }
  const key = remoteTurnTimelineKey(scope, turnId, items);
  retainedRemoteKeys.set(identity, key);
  while (retainedRemoteKeys.size > RETAINED_REMOTE_KEY_LIMIT) {
    const oldest = retainedRemoteKeys.keys().next().value;
    if (oldest === undefined) {
      break;
    }
    retainedRemoteKeys.delete(oldest);
  }
  return key;
}
