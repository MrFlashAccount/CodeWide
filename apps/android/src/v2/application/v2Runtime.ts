import {
  v2SavedServerId,
  type SyncV2Session,
  type V2OperationStore,
  type V2ProjectionStore,
  type V2Query,
  type V2SavedServerDeletionStore,
} from "@codewide/sync-client/v2";
import { parsePairingPayload } from "@codewide/codex-protocol/pairing";

import type {
  PairingPreview,
  PairSavedServerInput,
  SavedServerRepository,
  UpdateSavedServerInput,
} from "./ports/savedServerRepository";
import { savedServerId as parseSavedServerId, type SavedServerId } from "../domain/ids";
import {
  CommandCapabilities,
  QueryCapabilities,
  type CommandSessionProvider,
} from "./commandCapabilities";
import { QueryResource } from "./resources/queryResource";
import { SavedServerConnectionResource } from "./resources/savedServerConnectionResource";
import { SavedServersResource } from "./resources/savedServersResource";
import { ServerSelectionResource } from "./resources/serverSelectionResource";
import { ObservableResource } from "./resources/resource";
import type { ProjectionResource } from "./resources/projectionResource";
import { TerminalController } from "./terminalController";
import { VoiceInputController } from "./voiceInputController";
import type { TerminalTransport } from "./ports/terminalTransport";
import type { PortTransport } from "./ports/portTransport";
import type { VoiceTransport } from "./ports/voiceTransport";
import { PortsResource } from "./resources/portsResource";
import type {
  CommandCorrelationScope,
  CommandCorrelationStore,
  CommandSettlement,
} from "./commandCorrelation";
import { CommandCorrelationResource } from "./resources/commandCorrelationResource";
import { AggregateProjectionResource } from "./resources/aggregateProjectionResource";

export interface RuntimeSessionProvider extends CommandSessionProvider {
  close(savedServerId: string): Promise<void>;
  closeAll(): Promise<void>;
  reconnect(savedServerId: string): void;
  open(
    savedServerId: string,
    currentThreadId?: string | null,
  ): Promise<{
    session: SyncV2Session;
    resource: ProjectionResource;
  }>;
}

interface V2RuntimeInput {
  correlations: CommandCorrelationStore;
  correlationId(): string;
  deletions: V2SavedServerDeletionStore;
  now(): number;
  operationId(): string;
  operations: V2OperationStore;
  portTransport: PortTransport;
  projections: V2ProjectionStore;
  repository: SavedServerRepository;
  savedServerId(): SavedServerId;
  sessions: RuntimeSessionProvider;
  terminalTransport: TerminalTransport;
  voiceTransport: VoiceTransport;
}

export class V2Runtime {
  readonly aggregate: AggregateProjectionResource;
  readonly savedServers: SavedServersResource;
  readonly selection = new ServerSelectionResource();
  readonly sessions: RuntimeSessionProvider;
  readonly commands: CommandCapabilities;
  readonly queries: QueryCapabilities;
  readonly terminal: TerminalController;
  readonly voice: VoiceInputController;
  readonly #repository: SavedServerRepository;
  readonly #deletions: V2SavedServerDeletionStore;
  readonly #operations: V2OperationStore;
  readonly #projections: V2ProjectionStore;
  readonly #correlations: CommandCorrelationStore;
  readonly #savedServerId: () => SavedServerId;
  readonly #portTransport: PortTransport;
  readonly #now: () => number;

  constructor(input: V2RuntimeInput) {
    this.#repository = input.repository;
    this.#deletions = input.deletions;
    this.#operations = input.operations;
    this.#projections = input.projections;
    this.#correlations = input.correlations;
    this.#savedServerId = input.savedServerId;
    this.#portTransport = input.portTransport;
    this.#now = input.now;
    this.sessions = input.sessions;
    this.commands = new CommandCapabilities({
      correlationId: input.correlationId,
      correlations: input.correlations,
      now: input.now,
      operationId: input.operationId,
      sessions: input.sessions,
    });
    this.queries = new QueryCapabilities(input.sessions);
    this.terminal = new TerminalController(input.terminalTransport);
    this.voice = new VoiceInputController(input.voiceTransport);
    this.savedServers = new SavedServersResource(input.repository);
    this.aggregate = new AggregateProjectionResource(input.projections, input.deletions);
  }

  async start(): Promise<void> {
    await this.#recoverPendingDeletions();
    await this.savedServers.start();
    const servers = this.savedServers.snapshot().value;
    await this.aggregate.start(
      servers.map((value) => {
        const { id } = value;
        return id;
      }),
    );
    const openings: Array<Promise<unknown>> = [];
    for (const server of servers) {
      if (server.enabled && !(await this.#deletions.pending(v2SavedServerId(server.id)))) {
        openings.push(this.sessions.open(server.id));
      }
    }
    await Promise.allSettled(openings);
  }

  async stop(): Promise<void> {
    this.aggregate.stop();
    this.savedServers.stop();
    await this.sessions.closeAll();
    this.#repository.close();
  }

  savedServerConnection(savedServerId: SavedServerId): SavedServerConnectionResource {
    return new SavedServerConnectionResource(this.#repository, savedServerId);
  }

  ports(savedServerId: SavedServerId): PortsResource {
    return new PortsResource(this.#portTransport, savedServerId);
  }

  commandCorrelations(
    scope: CommandCorrelationScope,
    onSettlement: ((settlement: CommandSettlement) => void) | null = null,
  ): CommandCorrelationResource {
    return new CommandCorrelationResource(this.commands, scope, onSettlement);
  }

  now(): number {
    return this.#now();
  }

  async pairSavedServerLink(raw: string): Promise<SavedServerId> {
    const parsed = this.parseSavedServerLink(raw);
    return this.pairSavedServer(parsed);
  }

  parseSavedServerLink(raw: string): PairingPreview {
    const parsed = parsePairingPayload(raw, this.#now());
    return {
      displayName: parsed.displayName,
      emoji: parsed.emoji,
      endpoint: parsed.endpoint,
      expiresAt: parsed.expiresAt,
      pairingToken: parsed.pairingToken,
      tlsPinSha256: parsed.tlsPinSha256,
    };
  }

  async pairSavedServer(input: PairSavedServerInput): Promise<SavedServerId> {
    const parsed = validatePairingInput(input, this.#now());
    const id = this.#savedServerId();
    await this.#repository.pair(id, {
      displayName: parsed.displayName,
      emoji: parsed.emoji,
      endpoint: parsed.endpoint,
      pairingToken: parsed.pairingToken,
      tlsPinSha256: parsed.tlsPinSha256,
    });
    await this.#refreshSavedServers();
    await this.sessions.open(id);
    return id;
  }

  reconnect(savedServerId: SavedServerId): void {
    this.#repository.reconnect(savedServerId);
    this.sessions.reconnect(savedServerId);
  }

  async setSavedServerEnabled(savedServerId: SavedServerId, enabled: boolean): Promise<void> {
    await this.#repository.setEnabled(savedServerId, enabled);
    await this.#refreshSavedServers();
    if (enabled) await this.sessions.open(savedServerId);
  }

  async moveSavedServer(savedServerId: SavedServerId, direction: -1 | 1): Promise<void> {
    await this.#repository.move(savedServerId, direction);
    await this.#refreshSavedServers();
  }

  async updateSavedServer(
    savedServerId: SavedServerId,
    input: UpdateSavedServerInput,
  ): Promise<void> {
    await this.#repository.update(savedServerId, input);
    await this.#refreshSavedServers();
    this.sessions.reconnect(savedServerId);
  }

  /**
   * Deletes exactly one saved-server namespace. The durable intent remains until
   * every V2 partition is gone, so a process death resumes cleanup on startup.
   */
  async deleteSavedServer(savedServerId: SavedServerId): Promise<void> {
    await this.#deletions.begin(v2SavedServerId(savedServerId));
    await this.voice.cancelSavedServer(savedServerId);
    await this.sessions.close(savedServerId);
    await this.#repository.delete(savedServerId);
    await this.#purgeSavedServer(savedServerId);
    await this.#deletions.complete(v2SavedServerId(savedServerId));
    await this.#refreshSavedServers();
  }

  projection(
    savedServerId: string,
    currentThreadId: string | null = null,
  ): ObservableResource<ProjectionResource | null> {
    const result = new ObservableResource<ProjectionResource | null>(null);
    void this.sessions.open(savedServerId, currentThreadId).then(
      (openedSession) => {
        const { resource } = openedSession;
        result.publish({ status: "ready", value: resource });
      },
      () => {
        result.publish({ message: "Could not open saved server", status: "error", value: null });
      },
    );
    return result;
  }

  query(savedServerId: string, query: V2Query): ObservableResource<QueryResource | null> {
    const result = new ObservableResource<QueryResource | null>(null);
    void this.sessions.open(savedServerId).then(
      (openedSession) => {
        const { session } = openedSession;
        const resource = new QueryResource(session, query);
        resource.start();
        result.publish({ status: "ready", value: resource });
      },
      () => {
        result.publish({ message: "Could not open saved server", status: "error", value: null });
      },
    );
    return result;
  }

  async #recoverPendingDeletions(): Promise<void> {
    for (const savedServerId of await this.#deletions.listPending()) {
      await this.sessions.close(savedServerId);
      await this.#purgeSavedServer(parseSavedServerId(savedServerId));
      await this.#deletions.complete(savedServerId);
    }
  }

  async #purgeSavedServer(savedServerId: SavedServerId): Promise<void> {
    await this.#projections.deleteSavedServer(v2SavedServerId(savedServerId));
    await this.#operations.deleteSavedServer(v2SavedServerId(savedServerId));
    await this.#correlations.deleteSavedServer(savedServerId);
  }

  async #refreshSavedServers(): Promise<void> {
    await this.savedServers.refresh();
    await this.aggregate.replaceSavedServers(
      this.savedServers.snapshot().value.map((value) => {
        const { id } = value;
        return id;
      }),
    );
  }
}

function validatePairingInput(input: PairSavedServerInput, now: number): PairSavedServerInput {
  const parsed = parsePairingPayload(
    JSON.stringify({
      displayName: input.displayName,
      emoji: input.emoji,
      endpoint: input.endpoint,
      expiresAt: now + 60_000,
      pairingToken: input.pairingToken,
      tlsPinSha256: input.tlsPinSha256,
      type: "codewide-pairing",
      version: 1,
    }),
    now,
  );
  return {
    displayName: parsed.displayName,
    emoji: parsed.emoji,
    endpoint: parsed.endpoint,
    pairingToken: parsed.pairingToken,
    tlsPinSha256: parsed.tlsPinSha256,
  };
}
