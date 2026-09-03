import type { SyncV2SafeDiagnostic, SyncV2SessionSnapshot } from "@codewide/sync-client/v2";

import type { SavedServer } from "../../domain/savedServer";
import type { SavedServerId } from "../../domain/ids";
import type { ResourceSnapshot } from "./resource";
import { ObservableResource } from "./resource";

export type ServerConnectionState =
  | "accessRequired"
  | "connected"
  | "connecting"
  | "disabled"
  | "error"
  | "offline"
  | "updating";

export interface ServerConnectionStatus {
  detail: string | null;
  state: ServerConnectionState;
}

interface ProjectionSource {
  snapshot(): ResourceSnapshot<SyncV2SessionSnapshot>;
  subscribe(listener: () => void): () => void;
}

interface SessionSource {
  open(savedServerId: string): Promise<{
    resource: ProjectionSource;
    session: { safeDiagnostic(): SyncV2SafeDiagnostic | null };
  }>;
}

const OFFLINE: ServerConnectionStatus = { detail: null, state: "offline" };

/** Owns the live, per-saved-server transport status shown by aggregate settings UI. */
export class ServerConnectionStatusesResource extends ObservableResource<
  ReadonlyMap<SavedServerId, ServerConnectionStatus>
> {
  readonly #sessions: SessionSource;
  readonly #subscriptions = new Map<SavedServerId, () => void>();
  readonly #openingAttempts = new Map<SavedServerId, number>();
  #nextOpeningAttempt = 0;

  constructor(sessions: SessionSource) {
    super(new Map());
    this.#sessions = sessions;
  }

  replaceServers(servers: readonly SavedServer[]): void {
    const currentIds = new Set(servers.map((server) => server.id));
    for (const [id, unsubscribe] of this.#subscriptions) {
      if (currentIds.has(id)) continue;
      unsubscribe();
      this.#subscriptions.delete(id);
    }
    for (const id of this.#openingAttempts.keys()) {
      if (!currentIds.has(id)) this.#openingAttempts.delete(id);
    }
    const next = new Map<SavedServerId, ServerConnectionStatus>();
    for (const server of servers) {
      if (!server.enabled) {
        this.#subscriptions.get(server.id)?.();
        this.#subscriptions.delete(server.id);
        this.#openingAttempts.delete(server.id);
        next.set(server.id, { detail: null, state: "disabled" });
        continue;
      }
      next.set(
        server.id,
        this.snapshot().value.get(server.id) ?? { detail: null, state: "connecting" },
      );
      if (!this.#subscriptions.has(server.id) && !this.#openingAttempts.has(server.id)) {
        this.#open(server.id);
      }
    }
    this.publish({ status: "ready", value: next });
  }

  reconnect(savedServerId: SavedServerId): void {
    this.#publishOne(savedServerId, { detail: null, state: "connecting" });
    if (this.#subscriptions.has(savedServerId)) return;
    this.#openingAttempts.delete(savedServerId);
    this.#open(savedServerId);
  }

  stop(): void {
    for (const unsubscribe of this.#subscriptions.values()) unsubscribe();
    this.#subscriptions.clear();
    this.#openingAttempts.clear();
  }

  #open(savedServerId: SavedServerId): void {
    const attempt = ++this.#nextOpeningAttempt;
    this.#openingAttempts.set(savedServerId, attempt);
    void this.#sessions.open(savedServerId).then(
      (opened) => {
        if (this.#openingAttempts.get(savedServerId) !== attempt) return;
        this.#openingAttempts.delete(savedServerId);
        const { resource, session } = opened;
        const refresh = () =>
          this.#publishProjection(savedServerId, resource.snapshot(), session.safeDiagnostic());
        this.#subscriptions.set(savedServerId, resource.subscribe(refresh));
        refresh();
      },
      (cause: unknown) => {
        if (this.#openingAttempts.get(savedServerId) !== attempt) return;
        this.#openingAttempts.delete(savedServerId);
        const detail = safeErrorMessage(cause);
        this.#publishOne(savedServerId, {
          detail,
          state: requiresAccess(detail) ? "accessRequired" : "error",
        });
      },
    );
  }

  #publishProjection(
    savedServerId: SavedServerId,
    snapshot: ResourceSnapshot<SyncV2SessionSnapshot>,
    diagnostic: SyncV2SafeDiagnostic | null,
  ): void {
    if (snapshot.status === "error") {
      this.#publishOne(savedServerId, {
        detail: snapshot.message,
        state: requiresAccess(snapshot.message) ? "accessRequired" : "error",
      });
      return;
    }
    if (
      snapshot.value.state === "offline" &&
      this.snapshot().value.get(savedServerId)?.state === "connecting"
    ) {
      return;
    }
    this.#publishOne(savedServerId, statusFromSession(snapshot.value.state, diagnostic));
  }

  #publishOne(savedServerId: SavedServerId, status: ServerConnectionStatus): void {
    const previous = this.snapshot().value;
    const current = previous.get(savedServerId) ?? OFFLINE;
    if (current.state === status.state && current.detail === status.detail) return;
    // WHY: ObservableResource publishes by identity; copy only the changed Map shell.
    const next = new Map(previous);
    next.set(savedServerId, status);
    this.publish({ status: "ready", value: next });
  }
}

function statusFromSession(
  state: SyncV2SessionSnapshot["state"],
  diagnostic: SyncV2SafeDiagnostic | null,
): ServerConnectionStatus {
  if (state === "live") return { detail: null, state: "connected" };
  if (state === "reinitializing") return { detail: diagnostic?.detail ?? null, state: "updating" };
  if (state === "initializing") return { detail: null, state: "connecting" };
  if (state === "error") {
    const detail = diagnostic?.detail ?? "Secure connection failed";
    return { detail, state: requiresAccess(detail) ? "accessRequired" : "error" };
  }
  return OFFLINE;
}

function safeErrorMessage(cause: unknown): string {
  if (!(cause instanceof Error)) return "Could not establish secure connection";
  const message = cause.message.trim();
  return message === "" ? "Could not establish secure connection" : message.slice(0, 512);
}

function requiresAccess(detail: string): boolean {
  return /authori[sz]ation required|pairing required|access grant required|unauthorized/iu.test(
    detail,
  );
}
