import type { QualifiedThread } from "../../domain/qualifiedThread";

export type TerminalTransportEvent =
  | { type: "opened" }
  | { data: string; type: "output" }
  | { type: "exited" }
  | { message: string; type: "error" };

export interface TerminalTransport {
  open(
    owner: QualifiedThread,
    generation: string,
    cwd: string | null,
    listener: (event: TerminalTransportEvent) => void,
  ): Promise<{
    close(): Promise<void>;
    id: string;
    input(text: string): Promise<void>;
    resize(cols: number, rows: number): Promise<void>;
  }>;
}
