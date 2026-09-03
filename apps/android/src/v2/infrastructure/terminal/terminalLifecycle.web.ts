import type { TerminalLifecycle } from "../../application/ports/terminalLifecycle";

export function createTerminalLifecycle(): TerminalLifecycle {
  return {
    scheduleReconnect(_attempt, reconnect) {
      const timer = setTimeout(reconnect, 1000);
      return () => clearTimeout(timer);
    },
  };
}
