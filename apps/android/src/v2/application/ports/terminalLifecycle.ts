export interface TerminalLifecycle {
  scheduleReconnect(attempt: number, reconnect: () => void): () => void;
}
