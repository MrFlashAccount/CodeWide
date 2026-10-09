export type ThreadListItem = {
  /** Provider label for a thread not bound to its host's primary provider. */
  agentBadge?: string | null;
  /** Provider id of the badged thread, for its mark; set together with `agentBadge`. */
  agentProvider?: string | null;
  archived?: boolean;
  id: string;
  needsAttention?: boolean;
  pinned: boolean;
  preview: string;
  serverId: string;
  state?: "running" | "approval" | "failed";
  time?: string;
  timestamp?: number;
  title: string;
  unread: number;
};
