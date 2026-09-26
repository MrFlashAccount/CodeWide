/** Thread changes and attachments shared by projection and persistence owners. */
export type ThreadChangeResource = {
  additions: number;
  availability: "available" | "deleted" | "unavailable" | "unknown";
  binary?: boolean;
  /** First recorded operation in this scope; VCS snapshots omit this flag. */
  createdInScope?: boolean;
  deletions: number;
  itemId: string;
  kind: "add" | "delete" | "update";
  path: string;
  turnId: string;
};

export type ThreadChangeScope =
  | "session"
  | "lastTurn"
  | "staged"
  | "unstaged"
  | "uncommitted"
  | "branch";

export type ThreadResourceKind = "changes" | "attachments";

export type ThreadAttachmentResource = {
  itemId: string;
  key: string;
  kind: "image" | "audio" | "file";
  name: string;
  origin: "user" | "agent";
  path: string | null;
  turnId: string;
  url: string | null;
};

export type ThreadResourcesValue = {
  attachments: ThreadAttachmentResource[];
  changes: ThreadChangeResource[];
  changeScope: ThreadChangeScope;
  changeScopes: ThreadChangeScope[];
  revision: string;
  threadId: string;
};

export type ThreadResourcesRow = {
  connectionId: string;
  error: string | null;
  id: string;
  /** Resource-specific refresh state. Older persisted rows fall back to `status`. */
  pendingKinds?: readonly ThreadResourceKind[];
  readyKinds?: readonly ThreadResourceKind[];
  resourceErrors?: Partial<Record<ThreadResourceKind, string>>;
  status: "loading" | "ready" | "error";
  threadId: string;
  updatedAt: number;
  value: ThreadResourcesValue | null;
};

export type ThreadChangeDiffValue = {
  changeScope: ThreadChangeScope;
  patches: Array<{
    diff: string;
    itemId: string;
    kind: "add" | "delete" | "update";
    turnId: string;
  }>;
  path: string;
  source: string | null;
  threadId: string;
  truncated: boolean;
};
