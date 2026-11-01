import { createAsyncStoragePersister } from "@tanstack/query-async-storage-persister";
import type { Persister } from "@tanstack/react-query-persist-client";

/** In-memory AsyncStorage fixture passed through TanStack's real persister. */
export function createMemoryQueryPersister(): {
  readonly overwrite: (value: string) => void;
  readonly persister: Persister;
  readonly read: () => string | null;
} {
  let payload: string | null = null;
  return {
    overwrite: (value) => {
      payload = value;
    },
    persister: createAsyncStoragePersister({
      storage: {
        getItem: async () => payload,
        removeItem: async () => {
          payload = null;
        },
        setItem: async (_key, value) => {
          payload = value;
        },
      },
      throttleTime: 0,
    }),
    read: () => payload,
  };
}
