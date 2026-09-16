import { localOnlyCollectionOptions } from "@tanstack/db";
import { createCollection, type Collection } from "@tanstack/react-db";

import type { TurnControlsRow } from "./turn-controls-types";

export function createTurnControlsCollection(): Collection<TurnControlsRow, string> {
  return createCollection(
    localOnlyCollectionOptions<TurnControlsRow, string>({
      getKey: (row) => row.id,
      id: "workspace-turn-controls-v2-web",
    }),
  );
}
