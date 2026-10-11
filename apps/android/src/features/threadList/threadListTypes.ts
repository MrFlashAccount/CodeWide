export type ThreadListItem = {
  /** Declared provider label; absent only for a legacy or malformed descriptor. */
  agentBadge?: string | null;
  /** Declared provider id for its mark; set with `agentBadge` when valid. */
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
