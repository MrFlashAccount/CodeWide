import type { TunnelLifecycleProps } from "../../application/ports/tunnelLifecycle";
import { useTunnelLifecycle } from "../../infrastructure/react/useTunnelLifecycle";

/** React adapter for bounded tunnel expiry and route-disposal cleanup. */
export function TunnelLifecycle(props: TunnelLifecycleProps): null {
  useTunnelLifecycle(props);
  return null;
}
