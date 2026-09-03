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
import { CommandActivationOwner } from "./commandActivationOwner";
import { QueryResource } from "./resources/queryResource";
import { SavedServerConnectionResource } from "./resources/savedServerConnectionResource";
import { SavedServersResource } from "./resources/savedServersResource";
import { ServerSelectionResource } from "./resources/serverSelectionResource";
import { ReloadableResource } from "./resources/resource";
import type { ProjectionResource } from "./resources/projectionResource";
import { TerminalController } from "./terminalController";
import { VoiceInputController } from "./voiceInputController";
import type { TerminalTransport } from "./ports/terminalTransport";
import type { TerminalLifecycle } from "./ports/terminalLifecycle";
import type { TerminalSessionStore } from "./ports/terminalSessionStore";
import { createVolatileTerminalSessionStore } from "./ports/terminalSessionStore";
import type { PortTransport } from "./ports/portTransport";
import type { VoiceTransport } from "./ports/voiceTransport";
import type { PreviewMode, PreviewTransport } from "./preview/previewTransport";
import { PortsResource } from "./resources/portsResource";
import { PreviewResource } from "./resources/previewResource";
import type {
  CommandCorrelationScope,
  CommandCorrelationStore,
  CommandSettlement,
} from "./commandCorrelation";
import { CommandCorrelationResource } from "./resources/commandCorrelationResource";
import { AggregateProjectionResource } from "./resources/aggregateProjectionResource";
import { AggregateThreadCatalogResource } from "./resources/aggregateThreadCatalogResource";
import { ThreadCatalogResource } from "./resources/threadCatalogResource";
import type { ThreadPinStore } from "./ports/threadPinStore";
import { ThreadPinsResource } from "./resources/threadPinsResource";
import { ComposerAttachmentController } from "./composer/composerAttachmentController";
import type { ComposerAttachmentTransport } from "./ports/composerAttachmentTransport";
import type { ComposerDraftStore } from "./ports/composerDraftStore";
import { RequestResolutionCapabilities } from "./requestResolutionCapabilities";
import { ServerConnectionStatusesResource } from "./resources/serverConnectionStatusesResource";
import {
  BackgroundProcessesResource,
  backgroundProcessesKey,
} from "./resources/backgroundProcessesResource";
import type { QualifiedThread } from "../domain/qualifiedThread";
import type { DocumentViewerPreferenceStore } from "./ports/documentViewerPreferenceStore";

interface CachedThreadCatalog {
  resource: ThreadCatalogResource;
  source: ProjectionResource;
}

export interface RuntimeSessionProvider extends CommandSessionProvider {
  close(savedServerId: string): Promise<void>;
  closeAll(): Promise<void>;
  reconnect(savedServerId: string): void;
  resource(savedServerId: string): ProjectionResource;
  open(
    savedServerId: string,
    currentThreadId?: string | null,
  ): Promise<{
    session: SyncV2Session;
    resource: ProjectionResource;
  }>;
}

interface V2RuntimeInput {
  attachmentTransport: ComposerAttachmentTransport;
  composerDrafts: ComposerDraftStore;
  correlations: CommandCorrelationStore;
  correlationId(): string;
  deletions: V2SavedServerDeletionStore;
  documentViewerPreferences: DocumentViewerPreferenceStore;
  now(): number;
  operationId(): string;
  operations: V2OperationStore;
  portTransport: PortTransport;
  previewTransport: PreviewTransport;
  projections: V2ProjectionStore;
  repository: SavedServerRepository;
  savedServerId(): SavedServerId;
  sessions: RuntimeSessionProvider;
  terminalTransport: TerminalTransport;
  terminalLifecycle: TerminalLifecycle;
  terminalSessions?: TerminalSessionStore;
  threadPins: ThreadPinStore;
  voiceTransport: VoiceTransport;
}

export class V2Runtime {
  readonly composerAttachments: ComposerAttachmentController;
  readonly aggregate: AggregateProjectionResource;
  readonly aggregateThreadCatalog: AggregateThreadCatalogResource;
  readonly connectionStatuses: ServerConnectionStatusesResource;
  readonly documentViewerPreferences: DocumentViewerPreferenceStore;
  readonly savedServers: SavedServersResource;
  readonly selection = new ServerSelectionResource();
  readonly sessions: RuntimeSessionProvider;
  readonly commands: CommandCapabilities;
  readonly commandActivations: CommandActivationOwner;
  readonly queries: QueryCapabilities;
  readonly requests: RequestResolutionCapabilities;
  readonly terminal: TerminalController;
  readonly threadPins: ThreadPinsResource;
  readonly voice: VoiceInputController;
  readonly #repository: SavedServerRepository;
  readonly #deletions: V2SavedServerDeletionStore;
  readonly #operations: V2OperationStore;
  readonly #projections: V2ProjectionStore;
  readonly #correlations: CommandCorrelationStore;
  readonly #savedServerId: () => SavedServerId;
  readonly #portTransport: PortTransport;
  readonly #previewTransport: PreviewTransport;
  readonly #ports = new Map<SavedServerId, PortsResource>();
  readonly #backgroundProcesses = new Map<string, BackgroundProcessesResource>();
  readonly #threadCatalogs = new Map<SavedServerId, CachedThreadCatalog>();
  readonly #now: () => number;

  constructor(input: V2RuntimeInput) {
    this.documentViewerPreferences = input.documentViewerPreferences;
    this.#repository = input.repository;
    this.#deletions = input.deletions;
    this.#operations = input.operations;
    this.#projections = input.projections;
    this.#correlations = input.correlations;
    this.#savedServerId = input.savedServerId;
    this.#portTransport = input.portTransport;
    this.#previewTransport = input.previewTransport;
    this.#now = input.now;
    this.sessions = input.sessions;
    this.composerAttachments = new ComposerAttachmentController({
      now: input.now,
      store: input.composerDrafts,
      transport: input.attachmentTransport,
    });
    this.commands = new CommandCapabilities({
      correlationId: input.correlationId,
      correlations: input.correlations,
      now: input.now,
      operationId: input.operationId,
      sessions: input.sessions,
    });
    this.commandActivations = new CommandActivationOwner(this.commands);
    this.queries = new QueryCapabilities(input.sessions);
    this.requests = new RequestResolutionCapabilities(this.commandActivations);
    this.terminal = new TerminalController(
      input.terminalTransport,
      input.terminalLifecycle,
      input.terminalSessions ?? createVolatileTerminalSessionStore(),
    );
    this.threadPins = new ThreadPinsResource(input.threadPins);
    this.voice = new VoiceInputController(input.voiceTransport, input.now);
    this.savedServers = new SavedServersResource(input.repository);
    this.connectionStatuses = new ServerConnectionStatusesResource(input.sessions);
    this.aggregate = new AggregateProjectionResource(input.projections, input.deletions);
    this.aggregateThreadCatalog = new AggregateThreadCatalogResource({
      availability: this.connectionStatuses,
      execute: (savedServerId, query) => this.queries.execute(savedServerId, query),
      source: this.aggregate,
    });
  }

  async start(): Promise<void> {
    await this.composerAttachments.start();
    await this.#recoverPendingDeletions();
    await this.threadPins.start();
    await this.savedServers.start();
    if (this.savedServers.snapshot().status === "error") {
      throw new Error("Saved server catalog did not start");
    }
    const servers = this.savedServers.snapshot().value;
    const enabledServerIds: SavedServerId[] = [];
    for (const server of servers) {
      if (server.enabled) enabledServerIds.push(server.id);
    }
    await this.terminal.start(enabledServerIds);
    this.connectionStatuses.replaceServers(servers);
    await this.aggregate.start(
      servers.map((value) => {
        const { id } = value;
        return id;
      }),
    );
    if (this.aggregate.snapshot().status === "error") {
      throw new Error("Thread projection catalog did not start");
    }
    const openings: Array<Promise<unknown>> = [];
    for (const server of servers) {
      if (server.enabled && !(await this.#deletions.pending(v2SavedServerId(server.id)))) {
        openings.push(this.sessions.open(server.id));
      }
    }
    await Promise.allSettled(openings);
  }

  async stop(): Promise<void> {
    await this.composerAttachments.dispose();
    this.aggregate.stop();
    this.connectionStatuses.stop();
    this.savedServers.stop();
    for (const ports of this.#ports.values()) ports.stopResource();
    this.#ports.clear();
    for (const processes of this.#backgroundProcesses.values()) processes.stop();
    this.#backgroundProcesses.clear();
    for (const catalog of this.#threadCatalogs.values()) catalog.resource.stop();
    this.#threadCatalogs.clear();
    await this.voice.cancelAll();
    await this.terminal.closeAll();
    await this.sessions.closeAll();
    this.#repository.close();
  }

  savedServerConnection(savedServerId: SavedServerId): SavedServerConnectionResource {
    return new SavedServerConnectionResource(this.#repository, savedServerId);
  }

  ports(savedServerId: SavedServerId): PortsResource {
    const current = this.#ports.get(savedServerId);
    if (current !== undefined) return current;
    const resource = new PortsResource(this.#portTransport, savedServerId);
    this.#ports.set(savedServerId, resource);
    return resource;
  }

  backgroundProcesses(owner: QualifiedThread): BackgroundProcessesResource {
    const key = backgroundProcessesKey(owner.savedServerId, owner.threadId);
    const current = this.#backgroundProcesses.get(key);
    if (current !== undefined) return current;
    const resource = new BackgroundProcessesResource({
      commands: this.commandActivations,
      owner,
      queries: this.queries,
    });
    this.#backgroundProcesses.set(key, resource);
    return resource;
  }

  preview(savedServerId: SavedServerId, sourceUrl: string, mode: PreviewMode): PreviewResource {
    return new PreviewResource(this.#previewTransport, savedServerId, sourceUrl, mode);
  }

  threadCatalog(savedServerId: SavedServerId, source: ProjectionResource): ThreadCatalogResource {
    const current = this.#threadCatalogs.get(savedServerId);
    if (current?.source === source) return current.resource;
    current?.resource.stop();
    const resource = new ThreadCatalogResource({
      execute: (query) => this.queries.execute(savedServerId, query),
      source,
    });
    this.#threadCatalogs.set(savedServerId, { resource, source });
    return resource;
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
    this.connectionStatuses.reconnect(savedServerId);
  }

  async setSavedServerEnabled(savedServerId: SavedServerId, enabled: boolean): Promise<void> {
    await this.#repository.setEnabled(savedServerId, enabled);
    await this.#refreshSavedServers();
    if (enabled) await this.sessions.open(savedServerId);
    else {
      await this.terminal.closeSavedServer(savedServerId);
      await this.sessions.close(savedServerId);
    }
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
    this.connectionStatuses.reconnect(savedServerId);
  }

  /**
   * Deletes exactly one saved-server namespace. The durable intent remains until
   * every V2 partition is gone, so a process death resumes cleanup on startup.
   */
  async deleteSavedServer(savedServerId: SavedServerId): Promise<void> {
    await this.#deletions.begin(v2SavedServerId(savedServerId));
    await this.#completeSavedServerDeletion(savedServerId);
    await this.#deletions.complete(v2SavedServerId(savedServerId));
    await this.#refreshSavedServers();
  }

  /** Idempotent deletion body; its caller keeps the durable intent until this resolves. */
  async #completeSavedServerDeletion(savedServerId: SavedServerId): Promise<void> {
    await this.voice.cancelSavedServer(savedServerId);
    await this.terminal.closeSavedServer(savedServerId);
    await this.sessions.close(savedServerId);
    await this.#repository.delete(savedServerId);
    this.#ports.get(savedServerId)?.stopResource();
    this.#ports.delete(savedServerId);
    for (const [key, processes] of this.#backgroundProcesses) {
      if (key.startsWith(`${savedServerId}\u0000`)) {
        processes.stop();
        this.#backgroundProcesses.delete(key);
      }
    }
    this.#threadCatalogs.get(savedServerId)?.resource.stop();
    this.#threadCatalogs.delete(savedServerId);
    await this.#purgeSavedServer(savedServerId);
  }

  projection(
    savedServerId: string,
    currentThreadId: string | null = null,
  ): ReloadableResource<ProjectionResource | null> {
    const resource = this.sessions.resource(savedServerId);
    const result = new ReloadableResource<ProjectionResource | null>({
      errorMessage: "Could not open saved server",
      initialValue: resource,
      load: async () => {
        await this.sessions.open(savedServerId, currentThreadId);
        return resource;
      },
    });
    return result;
  }

  query<Q extends V2Query>(
    savedServerId: string,
    query: Q,
  ): ReloadableResource<QueryResource<Q> | null> {
    const result = new ReloadableResource<QueryResource<Q> | null>({
      errorMessage: "Could not open saved server",
      initialValue: null,
      load: async () => {
        const openedSession = await this.sessions.open(savedServerId);
        const { session } = openedSession;
        const resource = new QueryResource(session, query);
        return resource;
      },
    });
    return result;
  }

  async #recoverPendingDeletions(): Promise<void> {
    for (const savedServerId of await this.#deletions.listPending()) {
      await this.#completeSavedServerDeletion(parseSavedServerId(savedServerId));
      await this.#deletions.complete(savedServerId);
    }
  }

  async #purgeSavedServer(savedServerId: SavedServerId): Promise<void> {
    await this.#projections.deleteSavedServer(v2SavedServerId(savedServerId));
    await this.#operations.deleteSavedServer(v2SavedServerId(savedServerId));
    await this.#correlations.deleteSavedServer(savedServerId);
    await this.composerAttachments.deleteSavedServer(savedServerId);
    await this.threadPins.deleteSavedServer(savedServerId);
  }

  async #refreshSavedServers(): Promise<void> {
    await this.savedServers.refresh();
    this.connectionStatuses.replaceServers(this.savedServers.snapshot().value);
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
