export type PendingServerRequest = {
  connectionId: string;
  createdAt: number;
  method: string;
  params: Record<string, unknown>;
  requestId: string | number;
  requestKey: string;
  state: "pending" | "resolving";
};
