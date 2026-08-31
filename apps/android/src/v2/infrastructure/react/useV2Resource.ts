import { useSyncExternalStore } from "react";

import type { ObservableResource, ResourceSnapshot } from "../../application/resources/resource";

export function useV2Resource<T>(resource: ObservableResource<T>): ResourceSnapshot<T> {
  return useSyncExternalStore(resource.subscribe, resource.snapshot, resource.snapshot);
}
