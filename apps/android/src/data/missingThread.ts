/**
 * A thread the Companion no longer has (deleted elsewhere, or never known on
 * this host). Reading it fails with JSON-RPC error `-32073` (see
 * `docs/agent-providers.md`); the reader forgets the thread and reports it
 * here, so the owner of the open conversation can close it.
 */
import { RpcResponseError } from "@codewide/sync-client";

const THREAD_NOT_FOUND_RPC_CODE = -32_073;

/** Receives each thread reported missing, qualified by its connection. */
type MissingThreadListener = (connectionId: string, threadId: string) => void;

const listeners = new Set<MissingThreadListener>();

/** Whether `error` is the Companion's "thread not found" answer to a thread read. */
export function isThreadNotFound(error: unknown): boolean {
  return error instanceof RpcResponseError && error.code === THREAD_NOT_FOUND_RPC_CODE;
}

/** Tells every listener that the thread is gone. */
export function reportMissingThread(connectionId: string, threadId: string): void {
  for (const listener of listeners) {
    listener(connectionId, threadId);
  }
}

/** Listens for missing threads until the returned function is called. */
export function subscribeMissingThreads(listener: MissingThreadListener): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}
