export type AuthenticatedDuplexChannel = {
  readonly readyState: number;
  send(data: string): void;
  close(code?: number, reason?: string): void;
  addEventListener(type: "open", listener: () => void): void;
  addEventListener(type: "message", listener: (event: { data: unknown }) => void): void;
  addEventListener(type: "close", listener: () => void): void;
  addEventListener(type: "error", listener: () => void): void;
};

export type AuthenticatedRequest =
  | { operation: "file.download"; rootId: string; path: string; head: boolean }
  | { operation: "file.preview"; path: string; head: boolean }
  | { operation: "file.upload"; rootId: string; path: string; bodyBase64: string }
  | { operation: "file.uploadStatus"; rootId: string; path: string }
  | { operation: "file.uploadCancel"; rootId: string; path: string }
  | {
      operation: "content.read";
      digest: string;
      offset: number | null;
      limit: number | null;
      head: boolean;
    }
  | { operation: "media.materialize"; sourceUrl: string }
  | { operation: "media.read"; id: string; head: boolean }
  | { operation: "ports.list" }
  | { operation: "tunnel.create"; port: number; ttlSeconds: number | null }
  | { operation: "tunnel.delete"; tunnelId: string };

export type AuthenticatedResponse = {
  status: number;
  contentType: string;
  bodyBase64: string;
};

export type AuthenticatedTransportLease = {
  readonly savedServerId: string;
  openDuplex(purpose: "sync-v2" | "terminal-v2" | "voice-v2"): AuthenticatedDuplexChannel;
  request(
    purpose: "files-v2" | "media-v2" | "ports-v2" | "tunnels-v2",
    input: AuthenticatedRequest,
  ): Promise<AuthenticatedResponse>;
  release(): Promise<void>;
};
