import { Redirect } from "expo-router";
import { useEffect } from "react";

import { activateRuntime, stopRuntime } from "../../src/boot/runtimeSlot";
import { useUiGenerationSnapshot } from "../../src/boot/useUiGenerationSnapshot";
import {
  startLegacyNativeRuntimeResources,
  stopLegacyNativeRuntimeResources,
} from "../../src/native/native-transport";
import { V1WorkspaceRouteComposition } from "./V1WorkspaceRouteComposition";
import { reportGlobalError } from "../../src/ui/global-error-store";
import { disposeAllRouteSessions } from "../../src/services/routeSessionPolicy";
import { newThreadService } from "../../src/services/threads/newThreadService";

// WHY: Expo Router reads this required route-module export before rendering the layout component.
// oxlint-disable-next-line react-doctor/only-export-components
export const unstable_settings = { anchor: "index", initialRouteName: "index" };

/** Keeps the V1 runtime mounted while Expo Router owns destination history. */
export default function V1WorkspaceLayout(): React.JSX.Element | null {
  const generation = useUiGenerationSnapshot();
  if (generation.status === "loading") {
    return null;
  }
  if (generation.status === "error") {
    return <Redirect href="/" />;
  }
  if (generation.generation === "v2") {
    return <Redirect href="/servers" />;
  }
  return <MountedV1Workspace />;
}

/** Owns V1 runtime activation and exact workspace teardown around the persistent composition. */
export function MountedV1Workspace(): React.JSX.Element {
  useEffect(() => {
    // Effects cannot await runtime activation; the attached handler reports every rejection.
    void activateRuntime("legacy", () => ({
      start: startLegacyNativeRuntimeResources,
      stop: stopLegacyNativeRuntimeResources,
    })).catch((error: unknown) => {
      reportGlobalError(error, "manual", true);
    });
    return () => {
      disposeAllRouteSessions();
      newThreadService.dispose();
      // Effect cleanup cannot await runtime shutdown; the attached handler reports every rejection.
      void stopRuntime("legacy").catch((error: unknown) => {
        reportGlobalError(error, "manual", true);
      });
    };
  }, []);

  return <V1WorkspaceRouteComposition />;
}
