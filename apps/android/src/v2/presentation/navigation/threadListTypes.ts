export type ThreadListFilter = "all" | "approval" | "pinned" | "running" | "unread";

export interface ThreadListRow {
  archived?: boolean;
  authoritativeSearchMatch?: boolean;
  id: string;
  latestActivityMarker: string | null;
  pinned?: boolean;
  preview?: string;
  retained: boolean;
  state: string;
  title: string;
  unread: number;
  updatedAt: string;
}

export interface ThreadListRowActions {
  archive(id: string, archived: boolean): Promise<void>;
  copyId(id: string): Promise<void>;
  markRead(id: string, throughActivityMarker: string): Promise<void>;
  togglePin(id: string, pinned: boolean): Promise<void>;
}

export interface ThreadListVoiceControl {
  activate(): Promise<void>;
  disabled: boolean;
  state: "error" | "finishing" | "idle" | "recording" | "retry" | "starting";
}

export interface ThreadListPagingControl {
  canLoadMore: boolean;
  error: string | null;
  loadingLabel?: string;
  loading: boolean;
  loadMore(): Promise<void>;
}
