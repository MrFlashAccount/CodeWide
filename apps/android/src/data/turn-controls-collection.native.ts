import type { Collection } from "@tanstack/react-db";

import { createPersistentCollectionModel } from "./persistent-collection.native";
import { getUiCacheSqliteDatabase } from "./ui-cache-persistence.native";
import type { TurnControlsRow } from "./turn-controls-types";

/** Durable stale-while-revalidate source for model, skill and permission catalogs. */
export function createTurnControlsCollection(): Collection<TurnControlsRow, string> {
  return createPersistentCollectionModel<TurnControlsRow, string>({
    id: "workspace-turn-controls-v2",
    tableName: "codewide_turn_controls",
    schemaVersion: 2,
    database: getUiCacheSqliteDatabase(),
    getKey: (row) => row.id,
    columns: [{ property: "updatedAt", column: "updated_at", type: "REAL" }],
    legacyCollectionId: "workspace-turn-controls-v2",
  }).collection;
}
