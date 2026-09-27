import { serverIconIdFromLegacy } from "./serverIcons";
import type { ConnectionProfileRow } from "./connection-profile-types";
import { unknownRecord } from "./unknownRecord";

/** Validates SQLite payloads and upgrades the former emoji-only profile in memory. */
export function decodeConnectionProfileRow(payload: string): ConnectionProfileRow {
  return connectionProfileRowFromUnknown(JSON.parse(payload));
}

/** Converts an untrusted external profile value into the internal persisted contract. */
export function connectionProfileRowFromUnknown(value: unknown): ConnectionProfileRow {
  const row = unknownRecord(value);
  if (row === null) {
    throw new Error("Invalid persisted connection profile");
  }
  return {
    displayName: stringField(row, "displayName"),
    enabled: booleanField(row, "enabled"),
    endpoint: stringField(row, "endpoint"),
    iconId: serverIconIdFromLegacy(row.iconId, row.emoji),
    id: stringField(row, "id"),
    sortOrder: finiteNumberField(row, "sortOrder"),
    tlsPinSha256: nullableStringField(row, "tlsPinSha256"),
    updatedAt: finiteNumberField(row, "updatedAt"),
  };
}

function stringField(row: Record<string, unknown>, key: string): string {
  const value = row[key];
  if (typeof value !== "string") {
    throw new Error("Invalid persisted connection profile");
  }
  return value;
}

function booleanField(row: Record<string, unknown>, key: string): boolean {
  const value = row[key];
  if (typeof value !== "boolean") {
    throw new Error("Invalid persisted connection profile");
  }
  return value;
}

function finiteNumberField(row: Record<string, unknown>, key: string): number {
  const value = row[key];
  if (typeof value !== "number" || !Number.isFinite(value)) {
    throw new Error("Invalid persisted connection profile");
  }
  return value;
}

function nullableStringField(row: Record<string, unknown>, key: string): string | null {
  const value = row[key];
  if (value !== null && typeof value !== "string") {
    throw new Error("Invalid persisted connection profile");
  }
  return value;
}
