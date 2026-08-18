export type PendingServerRequest = {
  connectionId: string;
  requestKey: string;
  requestId: string | number;
  method: string;
  params: Record<string, unknown>;
  state: "pending" | "resolving";
  createdAt: number;
};
