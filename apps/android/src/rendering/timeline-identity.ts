type TimelineIdentityItem = { type?: unknown; clientId?: unknown };

export function optimisticTimelineKey(scope: string, clientId: string): string {
  return `turn-client:${scope}:${clientId}`;
}

export function remoteTurnTimelineKey(
  scope: string,
  turnId: string,
  items: readonly TimelineIdentityItem[],
): string {
  const clientId = items.find((item) => item.type === "userMessage" && typeof item.clientId === "string")?.clientId;
  return typeof clientId === "string" && clientId.length > 0
    ? optimisticTimelineKey(scope, clientId)
    : `turn-remote:${scope}:${turnId}`;
}
