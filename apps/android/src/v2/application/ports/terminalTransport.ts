import type { V2TransportError, V2U64 } from "@codewide/sync-client/v2";

import type { QualifiedThread } from "../../domain/qualifiedThread";

export type TerminalTransportEvent =
  | { offset: V2U64; type: "opened" }
  | { data: string; nextOffset: V2U64; offset: V2U64; type: "output" }
  | { exitCode: number | null; offset: V2U64; signal: string | null; type: "exited" }
  | { error: V2TransportError; type: "error" }
  | { type: "disconnected" };

/** @testOnly Exact transport input seam imported by the controller regression suite. */
export interface TerminalOpenInput {
  cols: number;
  create: boolean;
  cwd: string | null;
  generation: V2U64;
  offset: V2U64;
  owner: QualifiedThread;
  rows: number;
  sessionId: string;
}

export interface TerminalTransportHandle {
  close(): Promise<void>;
  disconnect(): Promise<void>;
  input(text: string): Promise<void>;
  resize(cols: number, rows: number): Promise<void>;
}

export interface TerminalTransport {
  createSessionId(): string;
  open(
    input: TerminalOpenInput,
    listener: (event: TerminalTransportEvent) => void,
  ): Promise<TerminalTransportHandle>;
}
