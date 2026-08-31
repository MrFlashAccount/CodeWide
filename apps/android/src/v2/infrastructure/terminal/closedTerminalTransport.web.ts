import type { TerminalTransport } from "../../application/ports/terminalTransport";

export function createClosedTerminalTransport(): TerminalTransport {
  return {
    open: () => Promise.reject(new Error("Terminal is available on Android only")),
  };
}
