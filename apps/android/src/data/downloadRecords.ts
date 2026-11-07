import { unknownRecord } from "./unknownRecord";

declare const downloadIdBrand: unique symbol;

/** Opaque identity of one download in the device-wide history. */
export type DownloadId = string & { readonly [downloadIdBrand]: true };

/** Host files with a direct download route: an absolute host path or a path in a configured root. */
export type DownloadSource =
  | { readonly kind: "path"; readonly path: string }
  | { readonly kind: "scoped"; readonly path: string; readonly rootId: string };

/** Byte counters of an unfinished download; `totalBytes` is unknown until the host answers. */
type DownloadBytes = { readonly totalBytes: number | null; readonly transferredBytes: number };

export type DownloadState =
  | (DownloadBytes & {
      readonly phase: "starting" | "transferring" | "verifying";
      readonly status: "running";
    })
  | (DownloadBytes & { readonly status: "paused" })
  | {
      readonly bytes: number;
      readonly completedAt: number;
      readonly mimeType: string | null;
      readonly status: "completed";
      readonly uri: string;
    }
  | { readonly error: string; readonly status: "failed" }
  | { readonly status: "cancelled" }
  /** Unfinished when the app process ended; this process holds no access to continue it. */
  | (DownloadBytes & { readonly status: "interrupted" });

export type DownloadEntry = {
  readonly id: DownloadId;
  readonly name: string;
  readonly source: DownloadSource;
  readonly startedAt: number;
  readonly state: DownloadState;
};

/** Persisted history row. `state` holds the last durable transition, never per-chunk progress. */
export type DownloadHistoryRow = {
  readonly entry: DownloadEntry;
  readonly id: string;
  readonly startedAt: number;
};

const ID_RADIX = 36;
const ID_RANDOM_START = 2;
const ID_RANDOM_END = 10;

export function createDownloadId(startedAt: number): DownloadId {
  return brandDownloadId(
    `${startedAt.toString(ID_RADIX)}-${Math.random().toString(ID_RADIX).slice(ID_RANDOM_START, ID_RANDOM_END)}`,
  );
}

function brandDownloadId(value: string): DownloadId {
  // WHY: The brand records that this string was minted by `createDownloadId`, here or in a stored
  // row it wrote earlier; a brand has no runtime form to check.
  // oxlint-disable-next-line typescript/no-unsafe-type-assertion
  return value as DownloadId;
}

/** Restores one stored row. Unfinished downloads become `interrupted`: their transfer
 * and access lived in the previous process. Rows this build cannot read are dropped. */
export function restoreDownloadEntry(row: unknown): DownloadEntry | null {
  const entry = unknownRecord(unknownRecord(row)?.entry);
  if (entry === null) {
    return null;
  }
  const source = restoreSource(entry.source);
  const state = restoreState(entry.state);
  if (
    typeof entry.id !== "string" ||
    typeof entry.name !== "string" ||
    typeof entry.startedAt !== "number" ||
    source === null ||
    state === null
  ) {
    return null;
  }
  return {
    id: brandDownloadId(entry.id),
    name: entry.name,
    source,
    startedAt: entry.startedAt,
    state,
  };
}

function restoreSource(input: unknown): DownloadSource | null {
  const value = unknownRecord(input);
  if (value === null || typeof value.path !== "string") {
    return null;
  }
  if (value.kind === "path") {
    return { kind: "path", path: value.path };
  }
  if (value.kind === "scoped" && typeof value.rootId === "string") {
    return { kind: "scoped", path: value.path, rootId: value.rootId };
  }
  return null;
}

function restoreState(input: unknown): DownloadState | null {
  const value = unknownRecord(input);
  switch (value?.status) {
    case "completed":
      return restoreCompleted(value);
    case "failed":
      return typeof value.error === "string" ? { error: value.error, status: "failed" } : null;
    case "cancelled":
      return { status: "cancelled" };
    case "running":
    case "paused":
    case "interrupted":
      return {
        status: "interrupted",
        totalBytes: typeof value.totalBytes === "number" ? value.totalBytes : null,
        transferredBytes: typeof value.transferredBytes === "number" ? value.transferredBytes : 0,
      };
    default:
      return null;
  }
}

function restoreCompleted(value: Record<string, unknown>): DownloadState | null {
  const { bytes, completedAt, mimeType, uri } = value;
  if (
    typeof bytes !== "number" ||
    typeof completedAt !== "number" ||
    typeof uri !== "string" ||
    (typeof mimeType !== "string" && mimeType !== null)
  ) {
    return null;
  }
  return { bytes, completedAt, mimeType, status: "completed", uri };
}
