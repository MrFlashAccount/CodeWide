import type { ConnectionId } from "./model";

const KEY_SEPARATOR = "\u0000";

function assertPart(value: string, label: string): void {
  if (value.length === 0 || value.includes(KEY_SEPARATOR)) {
    throw new Error(`${label} is empty or contains the reserved key separator`);
  }
}

export function connectionId(value: string): ConnectionId {
  assertPart(value, "connectionId");
  return value as ConnectionId;
}

export function threadKey(connection: ConnectionId, remoteThreadId: string): string {
  assertPart(remoteThreadId, "remoteThreadId");
  return `${connection}${KEY_SEPARATOR}${remoteThreadId}`;
}

export function turnKey(connection: ConnectionId, remoteThreadId: string, turnId: string): string {
  assertPart(turnId, "turnId");
  return `${threadKey(connection, remoteThreadId)}${KEY_SEPARATOR}${turnId}`;
}

export function itemKey(
  connection: ConnectionId,
  remoteThreadId: string,
  turnId: string,
  itemId: string,
): string {
  assertPart(itemId, "itemId");
  return `${turnKey(connection, remoteThreadId, turnId)}${KEY_SEPARATOR}${itemId}`;
}
