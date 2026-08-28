import type { Collection } from "@tanstack/react-db";

import type { UserPreferenceRow } from "./user-preferences";

export type UserPreferencesDatabase = {
  collection: Collection<UserPreferenceRow, string>;
  ready: Promise<void>;
  update(id: string, apply: (current: string | null) => string): Promise<void>;
};
