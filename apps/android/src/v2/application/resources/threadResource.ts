import type { V2ThreadWindow } from "@codewide/sync-client/v2";
import type { QualifiedThread } from "../../domain/qualifiedThread";
import type { ProjectionResource } from "./projectionResource";

export function readThread(
  resource: ProjectionResource,
  owner: QualifiedThread,
): V2ThreadWindow | null {
  const views = resource.snapshot().value.projections;
  const projection = views.live ?? views.retained;
  return projection?.currentThread?.thread.id === owner.threadId ? projection.currentThread : null;
}
