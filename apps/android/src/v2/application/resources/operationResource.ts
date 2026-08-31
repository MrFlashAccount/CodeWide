import type { V2OperationStatus } from "@codewide/sync-client/v2";
import type { ProjectionResource } from "./projectionResource";

export function readOperationStatuses(resource: ProjectionResource): V2OperationStatus[] {
  return resource.snapshot().value.operations;
}
