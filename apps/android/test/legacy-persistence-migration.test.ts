import { describe, expect, it, vi } from "vitest";

import { readLegacyPersistedRows } from "../src/data/legacy-persistence-migration.native";

describe("legacy persistence migration", () => {
  it("decodes the former adapter payload without starting its runtime", async () => {
    const execute = vi.fn(async (sql: string) => {
      if (sql.includes("sqlite_master")) return { rows: [{ name: "collection_registry" }] };
      if (sql.includes("collection_registry")) return { rows: [{ table_name: "c_legacy_1" }] };
      return {
        rows: [{
          value: JSON.stringify({
            id: "row-1",
            createdAt: { __tanstack_db_persisted_type__: "date", value: "2026-08-22T00:00:00.000Z" },
          }),
        }],
      };
    });
    const [row] = await readLegacyPersistedRows<{ id: string; createdAt: Date }>({ execute }, "legacy");
    expect(row?.id).toBe("row-1");
    expect(row?.createdAt).toEqual(new Date("2026-08-22T00:00:00.000Z"));
    expect(execute.mock.calls.some(([sql]) => sql.includes("INSERT") || sql.includes("UPDATE") || sql.includes("DELETE"))).toBe(false);
  });

  it("treats an absent old registry as an empty import", async () => {
    const execute = vi.fn(async () => ({ rows: [] }));
    await expect(readLegacyPersistedRows({ execute }, "missing")).resolves.toEqual([]);
    expect(execute).toHaveBeenCalledTimes(1);
  });

  it("skips a corrupt obsolete row without blocking valid model bootstrap", async () => {
    const execute = vi.fn(async (sql: string) => {
      if (sql.includes("sqlite_master")) return { rows: [{ name: "collection_registry" }] };
      if (sql.includes("collection_registry")) return { rows: [{ table_name: "c_legacy_1" }] };
      return { rows: [{ value: "{" }, { value: JSON.stringify({ id: "valid" }) }] };
    });

    await expect(readLegacyPersistedRows<{ id: string }>({ execute }, "legacy")).resolves.toEqual([{ id: "valid" }]);
  });
});
