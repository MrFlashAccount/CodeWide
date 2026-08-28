export type V2SocketMessageEvent = { data: unknown };

/** Protocol-neutral socket seam; it has no V1 or App Server wire dependency. */
export interface V2SocketLike {
  readonly readyState: number;
  send(data: string): void;
  close(code?: number, reason?: string): void;
  addEventListener(type: "open", listener: () => void): void;
  addEventListener(type: "message", listener: (event: V2SocketMessageEvent) => void): void;
  addEventListener(type: "close", listener: () => void): void;
  addEventListener(type: "error", listener: () => void): void;
}
