import {
  createVolatileTerminalSessionStore,
  type TerminalSessionStore,
} from "../../application/ports/terminalSessionStore";

export function createTerminalSessionStore(): TerminalSessionStore {
  return createVolatileTerminalSessionStore();
}
