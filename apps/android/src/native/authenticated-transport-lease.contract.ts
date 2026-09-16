/** Authenticated bidirectional channel leased from the native transport. */
export type AuthenticatedDuplexChannel = {
  addEventListener: {
    (type: "open", listener: () => void): void;
    (type: "message", listener: (event: { data: unknown }) => void): void;
    (type: "close", listener: () => void): void;
    (type: "error", listener: () => void): void;
  };
  close: (code?: number, reason?: string) => void;
  readonly readyState: number;
  send: (data: string) => void;
};

/** Closed request set accepted by the authenticated native transport. */
export type AuthenticatedRequest =
  | { head: boolean; operation: "file.download"; path: string; rootId: string }
  | { head: boolean; operation: "file.preview"; path: string }
  | { bodyBase64: string; operation: "file.upload"; path: string; rootId: string }
  | { operation: "file.uploadStatus"; path: string; rootId: string }
  | { operation: "file.uploadCancel"; path: string; rootId: string }
  | {
      digest: string;
      head: boolean;
      limit: number | null;
      offset: number | null;
      operation: "content.read";
    }
  | { operation: "media.materialize"; sourceUrl: string }
  | { operation: "media.streamCreate"; sourceUrl: string }
  | {
      head: boolean;
      id: string;
      limit: number;
      offset: number;
      operation: "media.streamRead";
    }
  | { head: boolean; id: string; operation: "media.read" }
  | { operation: "ports.list" }
  | { operation: "tunnel.create"; port: number; ttlSeconds: number | null }
  | { operation: "tunnel.delete"; tunnelId: string };

/** Content response returned by an authenticated native request. */
export type AuthenticatedResponse = {
  bodyBase64: string;
  contentType: string;
  status: number;
};

/** Shared authenticated transport authority for one saved server. */
export type AuthenticatedTransportLease = {
  openDuplex: (purpose: "sync-v2" | "terminal-v2" | "voice-v2") => AuthenticatedDuplexChannel;
  release: () => Promise<void>;
  request: (
    purpose: "files-v2" | "media-v2" | "ports-v2" | "tunnels-v2",
    input: AuthenticatedRequest,
  ) => Promise<AuthenticatedResponse>;
  readonly savedServerId: string;
};
