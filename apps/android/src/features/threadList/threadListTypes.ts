export type ThreadListItem = {
  id: string;
  serverId: string;
  title: string;
  preview: string;
  time?: string;
  timestamp?: number;
  pinned: boolean;
  archived?: boolean;
  unread: number;
  state?: "running" | "approval" | "failed";
};
