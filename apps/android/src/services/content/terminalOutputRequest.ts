import type { GetTransferAccess } from "../../data/private-transfer";
import type { TerminalCommandSnapshot } from "../../data/terminalOutputEvents";

/** A captured process and its read capabilities; the output screen cannot stop it. */
export type TerminalOutputRequest = {
  readonly command: string;
  readonly connectionId: string;
  readonly getTransferAccess: GetTransferAccess;
  readonly isRunning: () => Promise<boolean>;
  readonly itemId: string;
  readonly kind: "backgroundTerminal";
  readonly processId: string;
  readonly read: (itemId: string, signal: AbortSignal) => Promise<TerminalCommandSnapshot | null>;
  readonly threadId: string;
};
