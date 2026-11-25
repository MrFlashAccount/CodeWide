import type { TerminalOutputEvent } from "../../../data/terminalOutputEvents";
import { checkAborted } from "../../../native/check-aborted";

const RESYNC_MS = 5000;
const MAX_PENDING_EVENTS = 1024;

/** A bounded, ordered stream inbox. A null read requests authoritative completion recovery. */
export class TerminalOutputQueue {
  private readonly events: TerminalOutputEvent[] = [];
  private wake: (() => void) | null = null;
  private overflow = false;

  push(event: TerminalOutputEvent): void {
    if (this.events.length >= MAX_PENDING_EVENTS) {
      this.overflow = true;
    } else {
      this.events.push(event);
    }
    this.wake?.();
  }

  async next(signal: AbortSignal): Promise<TerminalOutputEvent | null> {
    checkAborted(signal);
    if (this.events.length === 0 && !this.overflow) {
      await new Promise<void>((resolve) => {
        const finish = (): void => {
          clearTimeout(timer);
          signal.removeEventListener("abort", finish);
          this.wake = null;
          resolve();
        };
        const timer = setTimeout(finish, RESYNC_MS);
        this.wake = finish;
        signal.addEventListener("abort", finish, { once: true });
        if (signal.aborted) {
          finish();
        }
      });
    }
    checkAborted(signal);
    if (this.overflow) {
      throw new Error(
        "Terminal output arrived faster than it could be read. Reopen the output after the process finishes.",
      );
    }
    return this.events.shift() ?? null;
  }
}
