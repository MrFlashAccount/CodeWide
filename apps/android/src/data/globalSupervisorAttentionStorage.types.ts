import type { GlobalSupervisorQualifiedChatRef } from "./globalSupervisorBinding";

export const GLOBAL_SUPERVISOR_ATTENTION_SCHEMA_VERSION = 1;

type GlobalSupervisorAttentionKind = "blocked" | "completed" | "failed" | "needsInput";

export type GlobalSupervisorAttentionEvent = {
  readonly eventId: string;
  readonly kind: GlobalSupervisorAttentionKind;
  readonly observedAt: number;
  readonly sourceCursor: number | null;
  readonly summary: string;
  readonly supervisor: GlobalSupervisorQualifiedChatRef;
  readonly turnId: string | null;
  readonly worker: GlobalSupervisorQualifiedChatRef;
};

type AttentionStorageCommon = {
  readonly id: string;
  readonly observedAt: number;
  readonly rowKind: "attention" | "relation";
  readonly supervisorConnectionId: string;
  readonly supervisorThreadId: string;
  readonly workerConnectionId: string;
  readonly workerThreadId: string | null;
};

export type GlobalSupervisorRelationStorageRow = AttentionStorageCommon & {
  readonly relation:
    | {
        readonly createdAt: number;
        readonly source: string;
        readonly status: "creating";
      }
    | {
        readonly createdAt: number;
        readonly status: "active";
      };
  readonly rowKind: "relation";
};

export type GlobalSupervisorAttentionStorageRow = AttentionStorageCommon & {
  readonly attention: GlobalSupervisorAttentionEvent;
  readonly rowKind: "attention";
  readonly state: "acknowledged" | "pending";
};

export type GlobalSupervisorAttentionStoredRow =
  | GlobalSupervisorAttentionStorageRow
  | GlobalSupervisorRelationStorageRow;

export type GlobalSupervisorAttentionStorageChange =
  | { readonly row: GlobalSupervisorAttentionStoredRow; readonly type: "put" }
  | { readonly id: string; readonly type: "delete" };

/** Durable row store used by the supervisor attention owner. */
export type GlobalSupervisorAttentionStorage = {
  readonly close: () => void;
  readonly commit: (changes: readonly GlobalSupervisorAttentionStorageChange[]) => Promise<void>;
  readonly ready: Promise<void>;
  readonly rows: () => readonly GlobalSupervisorAttentionStoredRow[];
};
