import type { TerminalTransport } from "../../application/ports/terminalTransport";

export function createClosedTerminalTransport(sessionId: () => string): TerminalTransport {
  return {
    createSessionId: sessionId,
    async open(_input, listener) {
      listener({
        error: { code: "unavailable", message: "Terminal is available on Android only" },
        type: "error",
      });
      return {
        close: resolved,
        disconnect: resolved,
        input: rejected,
        resize: resolved,
      };
    },
  };
}

function resolved(): Promise<void> {
  return Promise.resolve();
}

function rejected(): Promise<void> {
  return Promise.reject(new Error("Terminal is available on Android only"));
}
