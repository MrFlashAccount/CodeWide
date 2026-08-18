export type JsonRpcId = number | string;

export type JsonRpcRequest = {
  id: JsonRpcId;
  method: string;
  params?: unknown;
};

export type JsonRpcNotification = {
  method: string;
  params?: unknown;
};

export type JsonRpcError = {
  code: number;
  message: string;
  data?: unknown;
};

export type JsonRpcResponse =
  | { id: JsonRpcId; result: unknown }
  | { id: JsonRpcId; error: JsonRpcError };

export type AppServerMessage =
  | JsonRpcRequest
  | JsonRpcNotification
  | JsonRpcResponse;

export class AppServerRpcError extends Error {
  readonly code: number;
  readonly data: unknown;

  constructor(error: JsonRpcError) {
    super(error.message);
    this.name = "AppServerRpcError";
    this.code = error.code;
    this.data = error.data;
  }
}

