import type { QualifiedThread } from "./qualifiedThread";

export interface TerminalSession {
  id: string;
  owner: QualifiedThread;
  state: "opening" | "live" | "closed" | "failed";
}
