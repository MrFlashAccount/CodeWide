/** Thread changes and attachments shared by projection and persistence owners. */
export type ThreadChangeResource = {
  path: string;
  kind: "add" | "delete" | "update";
  availability: "available" | "deleted" | "unavailable" | "unknown";
  additions: number;
  deletions: number;
  binary?: boolean;
  turnId: string;
  itemId: string;
};

export type ThreadChangeScope = "session" | "lastTurn" | "staged" | "unstaged" | "branch";

export type ThreadResourceKind = "changes" | "attachments";

export type ThreadAttachmentResource = {
  key: string;
  name: string;
  kind: "image" | "audio" | "file";
  path: string | null;
  url: string | null;
  origin: "user" | "agent";
  turnId: string;
  itemId: string;
};

export type ThreadResourcesValue = {
  threadId: string;
  revision: string;
  changeScope: ThreadChangeScope;
  changeScopes: ThreadChangeScope[];
  changes: ThreadChangeResource[];
  attachments: ThreadAttachmentResource[];
};

export type ThreadResourcesRow = {
  id: string;
  connectionId: string;
  threadId: string;
  status: "loading" | "ready" | "error";
  value: ThreadResourcesValue | null;
  error: string | null;
  /** Resource-specific refresh state. Older persisted rows fall back to `status`. */
  pendingKinds?: readonly ThreadResourceKind[];
  readyKinds?: readonly ThreadResourceKind[];
  resourceErrors?: Partial<Record<ThreadResourceKind, string>>;
  updatedAt: number;
};

export type ThreadChangeDiffValue = {
  threadId: string;
  path: string;
  changeScope: ThreadChangeScope;
  patches: Array<{
    turnId: string;
    itemId: string;
    kind: "add" | "delete" | "update";
    diff: string;
  }>;
  source: string | null;
  truncated: boolean;
};
