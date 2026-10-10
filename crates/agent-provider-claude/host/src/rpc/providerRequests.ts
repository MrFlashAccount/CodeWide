/**
 * Requests the host sends to the companion (provider requests such as
 * `tool.call`) and the matching of the companion's answers.
 *
 * Ids are host-minted (`claude-host:<n>`) and never collide with the
 * companion's own request ids, which the host only echoes. A request whose
 * signal aborts stops waiting at once; its late answer is ignored. Holds no
 * protocol knowledge beyond the JSON-RPC envelope.
 */

import type { ProviderRequestName, RpcId } from "../protocol.js";

/** How a provider request ended. */
export type ProviderAnswer =
  | { readonly message: string; readonly status: "error" }
  | { readonly result: unknown; readonly status: "result" }
  | { readonly status: "aborted" };

const ID_PREFIX = "claude-host:";

export class ProviderRequests {
  private nextId = 1;
  private readonly pending = new Map<string, (answer: ProviderAnswer) => void>();
  private readonly send: (message: unknown) => void;

  public constructor(send: (message: unknown) => void) {
    this.send = send;
  }

  /** Sends one request and resolves with the companion's answer, or `aborted`. */
  public async request(
    method: ProviderRequestName,
    params: unknown,
    signal: AbortSignal,
  ): Promise<ProviderAnswer> {
    if (signal.aborted) {
      return { status: "aborted" };
    }
    const id = `${ID_PREFIX}${String(this.nextId)}`;
    this.nextId += 1;
    return new Promise((resolve) => {
      const onAbort = (): void => {
        if (this.pending.delete(id)) {
          resolve({ status: "aborted" });
        }
      };
      this.pending.set(id, (answer) => {
        signal.removeEventListener("abort", onAbort);
        resolve(answer);
      });
      signal.addEventListener("abort", onAbort, { once: true });
      this.send({ id, method, params });
    });
  }

  /** Delivers an answer; returns whether a request was waiting for it. */
  public settle(
    id: RpcId,
    answer: Exclude<ProviderAnswer, { readonly status: "aborted" }>,
  ): boolean {
    const key = String(id);
    const resolve = this.pending.get(key);
    if (resolve === undefined) {
      return false;
    }
    this.pending.delete(key);
    resolve(answer);
    return true;
  }

  /** Ends every waiting request as `aborted` (host shutdown). */
  public abortAll(): void {
    for (const [id, resolve] of this.pending) {
      this.pending.delete(id);
      resolve({ status: "aborted" });
    }
  }
}
