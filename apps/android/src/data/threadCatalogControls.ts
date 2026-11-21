import { unknownRecord } from "./unknownRecord";

/** Last provider-reported values for display before the thread detail is ready. */
export type ThreadCatalogControls = {
  readonly accessPolicy?: CatalogAccessPolicy | null;
  readonly cursor: number;
  readonly effort: string | null;
  readonly model: string | null;
  readonly modelLabel: string | null;
  readonly permissions: string | null | undefined;
};

type CatalogAccessPolicy = {
  readonly approvalPolicy: string | null;
  readonly sandboxPolicy:
    | "dangerFullAccess"
    | "workspaceWrite"
    | "readOnly"
    | "externalSandbox"
    | "managed";
};

function readPolicy(value: unknown): CatalogAccessPolicy | null {
  const row = unknownRecord(value);
  const sandboxPolicy = row?.sandboxPolicy;
  switch (sandboxPolicy) {
    case "dangerFullAccess":
    case "workspaceWrite":
    case "readOnly":
    case "externalSandbox":
    case "managed":
      return { approvalPolicy: text(row?.approvalPolicy), sandboxPolicy };
    default:
      return null;
  }
}

function text(value: unknown): string | null {
  return typeof value === "string" && value.length > 0 ? value : null;
}

function decode(cursor: number, row: Record<string, unknown>): ThreadCatalogControls | null {
  const model = text(row.model);
  const permissions = row.permissions === undefined ? undefined : text(row.permissions);
  const accessPolicy = readPolicy(row.accessPolicy);
  return model === null && (permissions ?? null) === null && accessPolicy === null
    ? null
    : {
        accessPolicy,
        cursor,
        effort: text(row.effort),
        model,
        modelLabel: text(row.modelLabel),
        permissions,
      };
}

/** Reads only the execution fields in a list row. Older providers may omit any of them. */
export function readThreadCatalogControls(
  thread: unknown,
  cursor = 0,
): ThreadCatalogControls | null {
  const row = unknownRecord(thread);
  return row === null
    ? null
    : decode(cursor, {
        accessPolicy: row.codewideAccessPolicy,
        effort: row.reasoningEffort,
        model: row.model,
        modelLabel: row.codewideModelLabel,
        permissions: row.codewidePermissions,
      });
}

/** Validates the optional persisted fields, including summaries written by older clients. */
export function storedThreadCatalogControls(value: unknown): ThreadCatalogControls | null {
  const row = unknownRecord(value);
  if (row === null) {
    return null;
  }
  const cursor =
    typeof row.cursor === "number" && Number.isSafeInteger(row.cursor) && row.cursor >= 0
      ? row.cursor
      : 0;
  return decode(cursor, row);
}

/** Compares server-owned controls before publishing a replaced summary. */
export function sameThreadCatalogControls(
  left: ThreadCatalogControls | null,
  right: ThreadCatalogControls | null,
): boolean {
  if (left === null || right === null) {
    return left === right;
  }
  return (
    left.cursor === right.cursor &&
    sameAccessPolicy(left.accessPolicy, right.accessPolicy) &&
    left.model === right.model &&
    left.effort === right.effort &&
    left.modelLabel === right.modelLabel &&
    left.permissions === right.permissions
  );
}

function sameAccessPolicy(
  left: ThreadCatalogControls["accessPolicy"],
  right: ThreadCatalogControls["accessPolicy"],
): boolean {
  return (
    left?.sandboxPolicy === right?.sandboxPolicy && left?.approvalPolicy === right?.approvalPolicy
  );
}
