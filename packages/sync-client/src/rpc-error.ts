/** JSON-RPC error answer from the Companion, preserving its numeric code and structured `data`. */
export class RpcResponseError extends Error {
  readonly code: number;
  /** The error's JSON-RPC `data`, untrusted; `undefined` when the answer had none. */
  readonly data: unknown;

  constructor(code: number, message: string, data?: unknown) {
    super(message);
    this.name = "RpcResponseError";
    this.code = code;
    this.data = data;
  }
}
