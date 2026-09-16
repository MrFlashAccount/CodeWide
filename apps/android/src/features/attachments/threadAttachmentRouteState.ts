import type { ThreadAttachmentResource } from "../../data/thread-resource-types";
import type { useThreadResources } from "../../data/use-thread-resources";

const EMPTY_ATTACHMENTS: ThreadAttachmentResource[] = [];

type ThreadResource = ReturnType<typeof useThreadResources>;

type ThreadAttachmentRouteState = {
  readonly attachments: readonly ThreadAttachmentResource[];
  readonly error: string | null;
  readonly pending: boolean;
  readonly ready: boolean;
};

function attachmentsReady(resource: ThreadResource): boolean {
  if (resource?.readyKinds !== undefined) {
    return resource.readyKinds.includes("attachments");
  }
  return resource?.value !== null && resource?.value !== undefined;
}

function attachmentsPending(resource: ThreadResource): boolean {
  if (resource === null) {
    return true;
  }
  if (resource.pendingKinds !== undefined) {
    return resource.pendingKinds.includes("attachments");
  }
  return resource.status === "loading";
}

function attachmentError(resource: ThreadResource): string | null {
  const resourceError = resource?.resourceErrors?.attachments;
  if (resourceError !== undefined) {
    return resourceError;
  }
  if (resource?.readyKinds === undefined && resource?.status === "error") {
    return resource.error;
  }
  return null;
}

/** Projects the progressive thread resource into attachment-specific route state. */
export function attachmentRouteState(resource: ThreadResource): ThreadAttachmentRouteState {
  return {
    attachments: resource?.value?.attachments ?? EMPTY_ATTACHMENTS,
    error: attachmentError(resource),
    pending: attachmentsPending(resource),
    ready: attachmentsReady(resource),
  };
}
