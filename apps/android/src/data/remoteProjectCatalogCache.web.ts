import { getUserPreferencesDatabase } from "./user-preferences-database.web";
import { parseRemoteProjects, type RemoteProject } from "./remote-projects";

const CACHE_KEY_PREFIX = "remote-project-catalog:";
const database = getUserPreferencesDatabase();

function cacheKey(connectionId: string): string {
  return `${CACHE_KEY_PREFIX}${connectionId}`;
}

function decodeCachedProjects(value: string | null | undefined): RemoteProject[] {
  if (value === null || value === undefined) {
    return [];
  }
  try {
    const parsed: unknown = JSON.parse(value);
    return parseRemoteProjects({ data: parsed });
  } catch {
    return [];
  }
}

/** Process-local web fallback for the stale-while-refresh project catalog. */
export const remoteProjectCatalogCache = {
  async delete(connectionId: string): Promise<void> {
    await database.ready;
    const key = cacheKey(connectionId);
    if (database.collection.has(key)) {
      await database.collection.delete(key).isPersisted.promise;
    }
  },
  async read(connectionId: string): Promise<RemoteProject[]> {
    await database.ready;
    return decodeCachedProjects(database.collection.get(cacheKey(connectionId))?.value);
  },
  async write(connectionId: string, projects: readonly RemoteProject[]): Promise<void> {
    await database.update(cacheKey(connectionId), () => JSON.stringify(projects));
  },
};
