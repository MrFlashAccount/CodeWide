/** JSON-RPC error answer from the Companion, preserving its numeric code. */
export class RpcResponseError extends Error {
  readonly code: number;

  constructor(code: number, message: string) {
    super(message);
    this.name = "RpcResponseError";
    this.code = code;
  }
}
