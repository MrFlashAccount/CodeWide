import { useSelector } from "@legendapp/state/react";
import { useEffect } from "react";

import { remoteProjectCatalogCache } from "../../data/remoteProjectCatalogCache";
import { createRemoteProjectCatalogModel } from "../../data/remote-project-catalog-model";
import type { RemoteProject } from "../../data/remote-projects";
import { useEvent } from "../../react/useEvent";

type ProjectConnection = {
  enabled: boolean;
  id: string;
  state: string;
};

type RemoteProjectCatalog = {
  errorsByConnection: Record<string, string | null>;
  mergeProject: (connectionId: string, project: RemoteProject) => void;
  projectsByConnection: Record<string, RemoteProject[]>;
};

const remoteProjectCatalogModel = createRemoteProjectCatalogModel({
  cache: remoteProjectCatalogCache,
});

/**
 * React declares the demanded live connections. Legend owns Promise identity,
 * stale-while-refresh state and granular catalog publication.
 */
export function useRemoteProjectCatalog(
  native: boolean,
  connections: readonly ProjectConnection[],
  listProjects: (connectionId: string) => Promise<RemoteProject[]>,
): RemoteProjectCatalog {
  const load = useEvent(listProjects);
  const demandedConnections = native ? connections.filter((connection) => connection.enabled) : [];
  const demandedConnectionKey = demandedConnections
    .map((connection) => connection.id)
    .join("\u0000");
  for (const connection of demandedConnections) {
    const canRefresh = connection.state === "live" || connection.state === "syncing";
    remoteProjectCatalogModel.resource(
      connection.id,
      connection.state,
      canRefresh ? async () => load(connection.id) : null,
    );
  }
  useEffect(() => {
    const connectionIds = demandedConnectionKey === "" ? [] : demandedConnectionKey.split("\u0000");
    const releases = connectionIds.map((connectionId) =>
      remoteProjectCatalogModel.retain(connectionId),
    );
    return () => {
      for (const release of releases) {
        release();
      }
    };
  }, [demandedConnectionKey]);
  const snapshot = useSelector(() => remoteProjectCatalogModel.snapshot$.get());
  const mergeProject = useEvent((connectionId: string, project: RemoteProject) => {
    remoteProjectCatalogModel.mergeProject(connectionId, project);
  });

  return {
    errorsByConnection: snapshot.errorsByConnection,
    mergeProject,
    projectsByConnection: snapshot.projectsByConnection,
  };
}
