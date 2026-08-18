import { createCollection, type Collection } from "@tanstack/react-db";
import { persistedCollectionOptions } from "@tanstack/react-native-db-sqlite-persistence";

import { getUiCachePersistence } from "./ui-cache-persistence.native";
import type { TurnControlsRow } from "./turn-controls-types";

/** Durable stale-while-revalidate source for model, skill and permission catalogs. */
export function createTurnControlsCollection(): Collection<TurnControlsRow, string> {
  return createCollection(
    persistedCollectionOptions<TurnControlsRow, string>({
      id: "workspace-turn-controls-v2",
      schemaVersion: 1,
      getKey: (row) => row.id,
      persistence: getUiCachePersistence(),
    }),
  );
}
