import { useSelector } from "@legendapp/state/react";
import { useEffect } from "react";

import { useEvent } from "../react/useEvent";
import { remoteProjectCatalogModel } from "./remote-project-catalog-model";
import type { RemoteProject } from "./remote-projects";

type ProjectConnection = {
  id: string;
  enabled: boolean;
  state: string;
};

type RemoteProjectCatalog = {
  projectsByConnection: Record<string, RemoteProject[]>;
  errorsByConnection: Record<string, string | null>;
  mergeProject(connectionId: string, project: RemoteProject): void;
};

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
  const demandedConnections = native
    ? connections.filter((connection) => connection.enabled && (connection.state === "live" || connection.state === "syncing"))
    : [];
  const demandedConnectionKey = demandedConnections.map((connection) => connection.id).join("\u0000");
  for (const connection of demandedConnections) {
    remoteProjectCatalogModel.resource(
      connection.id,
      connection.state,
      async () => await load(connection.id),
    );
  }
  useEffect(() => {
    const connectionIds = demandedConnectionKey === "" ? [] : demandedConnectionKey.split("\u0000");
    const releases = connectionIds.map((connectionId) => remoteProjectCatalogModel.retain(connectionId));
    return () => {
      for (const release of releases) release();
    };
  }, [demandedConnectionKey]);
  const snapshot = useSelector(() => remoteProjectCatalogModel.snapshot$.get());
  const mergeProject = useEvent((connectionId: string, project: RemoteProject) => {
    remoteProjectCatalogModel.mergeProject(connectionId, project);
  });

  return {
    projectsByConnection: snapshot.projectsByConnection,
    errorsByConnection: snapshot.errorsByConnection,
    mergeProject,
  };
}
