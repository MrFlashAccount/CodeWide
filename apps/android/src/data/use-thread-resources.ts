import { useSelector } from "@legendapp/state/react";
import { useEffect } from "react";

import type { ThreadResourcesModel } from "./thread-resources-model";
import type { ThreadResourcesRow } from "./workspace-resource-database";

export function useThreadResources(
  model: ThreadResourcesModel | null,
  resourceId: string | null,
  loader?: () => Promise<unknown>,
  options: { suspense?: boolean; revision?: string } = {},
): ThreadResourcesRow | null {
  const ready$ = model === null || resourceId === null || loader === undefined
    ? null
    : model.resource(resourceId, options.revision ?? "default", loader);
  useEffect(() => {
    if (model === null || resourceId === null) return;
    return model.retain(resourceId);
  }, [model, resourceId]);
  useSelector(() => options.suspense === true && ready$ !== null ? ready$.get() : true, { suspense: true });
  return useSelector(() => model === null || resourceId === null ? null : model.row$(resourceId).get());
}
