import { useEffect } from "react";

import { activateRuntime, stopRuntime } from "../../../boot/runtimeSlot";
import type { V2Runtime } from "../../application/v2Runtime";

export function useV2RuntimeLifecycle(runtime: V2Runtime, active: boolean): void {
  useEffect(() => {
    if (!active) return undefined;
    let mounted = true;
    activateRuntime("v2", () => runtime)
      .then(async (active) => {
        if (mounted && active === runtime) await runtime.start();
      })
      .catch(() => undefined);
    return () => {
      mounted = false;
      stopRuntime("v2").catch(() => undefined);
    };
  }, [active, runtime]);
}
