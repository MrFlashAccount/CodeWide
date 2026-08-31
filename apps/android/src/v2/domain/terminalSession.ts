import type { QualifiedThread } from "./qualifiedThread";

export type TerminalSession = {
  id: string;
  owner: QualifiedThread;
  state: "opening" | "live" | "closed" | "failed";
};
