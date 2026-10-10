import type { Collection } from "@tanstack/react-db";

import { createPersistentCollectionModel } from "./persistent-collection.native";
import { getUiCacheSqliteDatabase } from "./ui-cache-persistence.native";
import type { TurnControlsRow } from "./turn-controls-types";

/** Durable stale-while-revalidate source for model, skill and permission catalogs. */
export function createTurnControlsCollection(): Collection<TurnControlsRow, string> {
  return createPersistentCollectionModel<TurnControlsRow, string>({
    columns: [{ column: "updated_at", property: "updatedAt", type: "REAL" }],
    database: getUiCacheSqliteDatabase(),
    getKey: (row) => row.id,
    id: "workspace-turn-controls-v2",
    legacyCollectionId: "workspace-turn-controls-v2",
    // v3: drops catalogs persisted before provider annotations; a stale row read
    // under a fallback key is never refreshed and lacks `provider`/`providers`.
    schemaVersion: 3,
    tableName: "codewide_turn_controls",
  }).collection;
}
