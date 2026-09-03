import { useEffect } from "react";

import type { TunnelLifecycleProps } from "../../application/ports/tunnelLifecycle";

/** Synchronizes a bounded server tunnel with wall-clock expiry and route disposal. */
export function useTunnelLifecycle(input: TunnelLifecycleProps): void {
  const { expiresAt, now, onDispose, onExpire, tunnelId } = input;
  useEffect(() => {
    let disposed = false;
    const dispose = (): void => {
      if (disposed) return;
      disposed = true;
      onDispose(tunnelId);
    };
    const remaining = expiresAt - now();
    if (remaining <= 0) {
      onExpire();
      dispose();
      return dispose;
    }
    const timer = setTimeout(() => {
      onExpire();
      dispose();
    }, remaining);
    return () => {
      clearTimeout(timer);
      dispose();
    };
  }, [expiresAt, now, onDispose, onExpire, tunnelId]);
}
