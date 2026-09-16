export type ThreadListItem = {
  archived?: boolean;
  id: string;
  pinned: boolean;
  preview: string;
  serverId: string;
  state?: "running" | "approval" | "failed";
  time?: string;
  timestamp?: number;
  title: string;
  unread: number;
};
