import type { TerminalTransport } from "./ports/terminalTransport";
import type { QualifiedThread } from "../domain/qualifiedThread";

export class TerminalController {
  readonly transport: TerminalTransport;
  constructor(transport: TerminalTransport) {
    this.transport = transport;
  }
  async open(
    owner: QualifiedThread,
    generation: string,
    cwd: string | null,
    listener: Parameters<TerminalTransport["open"]>[3],
  ): ReturnType<TerminalTransport["open"]> {
    return this.transport.open(owner, generation, cwd, listener);
  }
}
