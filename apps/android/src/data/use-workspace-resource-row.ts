import { eq, useLiveQuery } from "@tanstack/react-db";

import type {
  BackgroundTerminalsRow,
  ThreadGoalRow,
  TunnelRow,
  TurnControlsRow,
  WorkspaceResourceDatabase,
} from "./workspace-resource-database";

export function useTurnControlsRow(
  database: WorkspaceResourceDatabase | null,
  resourceId: string | null,
): TurnControlsRow | null {
  const query = useLiveQuery(
    (builder) => database === null || resourceId === null
      ? undefined
      : builder.from({ row: database.turnControls }).where(({ row }) => eq(row.id, resourceId)),
    [database, resourceId],
  );
  return query.data?.[0] ?? null;
}

export function useBackgroundTerminalsRow(
  database: WorkspaceResourceDatabase | null,
  resourceId: string | null,
): BackgroundTerminalsRow | null {
  const query = useLiveQuery(
    (builder) => database === null || resourceId === null
      ? undefined
      : builder.from({ row: database.backgroundTerminals }).where(({ row }) => eq(row.id, resourceId)),
    [database, resourceId],
  );
  return query.data?.[0] ?? null;
}

export function useThreadGoalRow(
  database: WorkspaceResourceDatabase | null,
  resourceId: string | null,
): ThreadGoalRow | null {
  const query = useLiveQuery(
    (builder) => database === null || resourceId === null
      ? undefined
      : builder.from({ row: database.threadGoals }).where(({ row }) => eq(row.id, resourceId)),
    [database, resourceId],
  );
  return query.data?.[0] ?? null;
}

export function useTunnelRow(
  database: WorkspaceResourceDatabase | null,
  resourceId: string | null,
): TunnelRow | null {
  const query = useLiveQuery(
    (builder) => database === null || resourceId === null
      ? undefined
      : builder.from({ row: database.tunnels }).where(({ row }) => eq(row.id, resourceId)),
    [database, resourceId],
  );
  return query.data?.[0] ?? null;
}
