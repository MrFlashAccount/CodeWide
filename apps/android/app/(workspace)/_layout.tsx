import { useEffect } from "react";

import { activateRuntime, stopRuntime } from "../../src/boot/runtimeSlot";
import { ForgeQueryProvider } from "../../src/data/ForgeQueryProvider";
import { forgeResources } from "../../src/data/forgeRuntime";
import {
  startLegacyNativeRuntimeResources,
  stopLegacyNativeRuntimeResources,
} from "../../src/native/native-transport";
import { WorkspaceRouteComposition } from "../../src/routeComposition/WorkspaceRouteComposition";
import { reportGlobalError } from "../../src/ui/global-error-store";
import { disposeAllRouteSessions } from "../../src/services/routeSessionPolicy";
import { newThreadService } from "../../src/services/threads/newThreadService";

/** Keeps the V1 runtime mounted while Expo Router owns destination history. */
export default function V1WorkspaceLayout(): React.JSX.Element {
  return <MountedV1Workspace />;
}

/** Owns V1 runtime activation and exact workspace teardown around the persistent composition. */
export function MountedV1Workspace(): React.JSX.Element {
  useEffect(() => {
    // Effects cannot await runtime activation; the attached handler reports every rejection.
    void activateRuntime(() => ({
      start: startLegacyNativeRuntimeResources,
      stop: stopLegacyNativeRuntimeResources,
    })).catch((error: unknown) => {
      reportGlobalError(error, "manual", true);
    });
    return () => {
      disposeAllRouteSessions();
      newThreadService.dispose();
      // Effect cleanup cannot await runtime shutdown; the attached handler reports every rejection.
      void stopRuntime().catch((error: unknown) => {
        reportGlobalError(error, "manual", true);
      });
    };
  }, []);

  return (
    <ForgeQueryProvider client={forgeResources.queryClient} restored={forgeResources.restored}>
      <WorkspaceRouteComposition />
    </ForgeQueryProvider>
  );
}
