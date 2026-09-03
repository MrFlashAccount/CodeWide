import type { TerminalLifecycle } from "../../application/ports/terminalLifecycle";

const MAX_RECONNECT_DELAY_MS = 5000;

export function createTerminalLifecycle(): TerminalLifecycle {
  return {
    scheduleReconnect(attempt, reconnect) {
      const delay = Math.min(250 * 2 ** Math.min(attempt - 1, 5), MAX_RECONNECT_DELAY_MS);
      const timer = setTimeout(reconnect, delay);
      return () => clearTimeout(timer);
    },
  };
}
