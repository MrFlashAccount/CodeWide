/** Qualified resource identities shared by lower models and their consumers. */
export function threadHistoryResourceKey(connectionId: string, threadId: string): string {
  return `${connectionId}\u0000${threadId}`;
}

export function turnControlsResourceKey(connectionId: string, cwd: string): string {
  return `${connectionId}\u0000${cwd}`;
}

export function threadResourceKey(connectionId: string, threadId: string): string {
  return `${connectionId}\u0000${threadId}`;
}

export function tunnelResourceKey(connectionId: string): string {
  return connectionId;
}
