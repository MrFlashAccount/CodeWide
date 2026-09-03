import type { V2U64 } from "@codewide/sync-client/v2";

import type { TerminalLifecycle } from "./ports/terminalLifecycle";
import type { TerminalSessionRecord, TerminalSessionStore } from "./ports/terminalSessionStore";
import { createVolatileTerminalSessionStore } from "./ports/terminalSessionStore";
import type { TerminalTransport, TerminalTransportEvent } from "./ports/terminalTransport";
import type {
  TerminalContextSnapshot,
  TerminalOverview,
  TerminalSession,
  TerminalWorkspace,
  TerminalWorkspaceSummary,
} from "../domain/terminalSession";
import { MAX_TERMINAL_TABS } from "../domain/terminalSession";
import type { SavedServerId } from "../domain/ids";
import type { QualifiedThread } from "../domain/qualifiedThread";
import {
  compareTerminalOffset,
  EMPTY_TERMINAL_CONTEXT,
  EMPTY_TERMINAL_OVERVIEW,
  type ManagedTerminal,
  type ManagedWorkspace,
  nextTerminalTitle,
  terminalWorkspaceKey,
} from "./terminalControllerModel";

export interface TerminalOutputEvent {
  data: string;
  nextOffset: V2U64;
}

/** Runtime owner for V2 Terminal sessions, replay cursors, and background tabs. */
export class TerminalController {
  readonly #lifecycle: TerminalLifecycle;
  readonly #listeners = new Set<() => void>();
  readonly #outputListeners = new Map<string, (event: TerminalOutputEvent) => Promise<void>>();
  readonly #transport: TerminalTransport;
  readonly #store: TerminalSessionStore;
  readonly #workspaces = new Map<string, ManagedWorkspace>();
  readonly #closing = new Map<string, Promise<void>>();
  readonly #opening = new Map<string, Promise<string>>();
  readonly #retryingReplay = new Map<string, Promise<string>>();
  #overview: TerminalOverview = EMPTY_TERMINAL_OVERVIEW;
  #stopped = false;

  constructor(
    transport: TerminalTransport,
    lifecycle: TerminalLifecycle,
    store: TerminalSessionStore = createVolatileTerminalSessionStore(),
  ) {
    this.#transport = transport;
    this.#lifecycle = lifecycle;
    this.#store = store;
  }

  async start(allowedSavedServerIds?: readonly SavedServerId[]): Promise<void> {
    if (this.#stopped) throw new Error("Terminal runtime is stopped");
    const allowed =
      allowedSavedServerIds === undefined ? null : new Set<SavedServerId>(allowedSavedServerIds);
    const records = await this.#store.list();
    const connections: Array<Promise<void>> = [];
    for (const record of records) {
      if (allowed !== null && !allowed.has(record.owner.savedServerId)) {
        await this.#store.delete(record.id);
        continue;
      }
      if (this.#terminal(record.id) !== null) continue;
      const workspace = this.#workspace(record.owner);
      if (workspace.sessions.length >= MAX_TERMINAL_TABS) {
        await this.#store.delete(record.id);
        continue;
      }
      const terminal = this.#restore(record);
      workspace.sessions.push(terminal);
      workspace.activeId ??= record.id;
      this.#publish(workspace);
      connections.push(this.#connect(terminal));
    }
    await Promise.allSettled(connections);
  }

  subscribe = (listener: () => void): (() => void) => {
    this.#listeners.add(listener);
    return () => this.#listeners.delete(listener);
  };

  overviewSnapshot = (): TerminalOverview => this.#overview;

  workspaceSnapshot(owner: QualifiedThread): TerminalWorkspace {
    return this.#workspace(owner).snapshot;
  }

  contextSnapshot(owner: QualifiedThread): TerminalContextSnapshot {
    const workspace = this.#workspaces.get(terminalWorkspaceKey(owner));
    return workspace?.context ?? EMPTY_TERMINAL_CONTEXT;
  }

  subscribeOutput(
    sessionId: string,
    listener: (event: TerminalOutputEvent) => Promise<void>,
  ): () => void {
    this.#outputListeners.set(sessionId, listener);
    return () => {
      if (this.#outputListeners.get(sessionId) === listener)
        this.#outputListeners.delete(sessionId);
    };
  }

  async open(owner: QualifiedThread, generation: V2U64, cwd: string | null): Promise<string> {
    const key = terminalWorkspaceKey(owner);
    const pending = this.#opening.get(key);
    if (pending !== undefined) return pending;
    const opening = this.#open(owner, generation, cwd);
    this.#opening.set(key, opening);
    try {
      return await opening;
    } finally {
      if (this.#opening.get(key) === opening) this.#opening.delete(key);
    }
  }

  async #open(owner: QualifiedThread, generation: V2U64, cwd: string | null): Promise<string> {
    if (this.#stopped) throw new Error("Terminal runtime is stopped");
    const workspace = this.#workspace(owner);
    if (workspace.sessions.length >= MAX_TERMINAL_TABS)
      throw new Error("Too many terminal tabs are open");
    const id = this.#transport.createSessionId();
    const terminal: ManagedTerminal = {
      cols: 80,
      connection: null,
      connectionVersion: 0,
      createOnConnect: true,
      generation,
      latestOffset: "0",
      missedOutput: false,
      model: {
        cwd,
        error: null,
        errorCode: null,
        exitCode: null,
        id,
        owner,
        signal: null,
        status: "connecting",
        title: nextTerminalTitle(workspace.sessions),
      },
      processExited: false,
      reconnectAttempt: 0,
      renderedOffset: "0",
      rendering: Promise.resolve(),
      rendererCount: 0,
      rendererWasAttached: false,
      retryCancellation: null,
      rows: 24,
      settled: false,
    };
    await this.#store.upsert(this.#record(terminal));
    workspace.sessions.push(terminal);
    workspace.activeId = id;
    this.#publish(workspace);
    await this.#connect(terminal);
    return id;
  }

  async ensureOpen(owner: QualifiedThread, generation: V2U64, cwd: string | null): Promise<string> {
    const workspace = this.#workspace(owner);
    const existing = workspace.sessions[0];
    if (existing !== undefined) return existing.model.id;
    return this.open(owner, generation, cwd);
  }

  select(owner: QualifiedThread, sessionId: string): void {
    const workspace = this.#workspaces.get(terminalWorkspaceKey(owner));
    if (
      workspace === undefined ||
      !workspace.sessions.some((candidate) => candidate.model.id === sessionId)
    )
      return;
    workspace.activeId = sessionId;
    this.#publish(workspace);
  }

  attachRenderer(sessionId: string): () => void {
    const terminal = this.#terminal(sessionId);
    if (terminal === null || terminal.settled) return () => undefined;
    const replacesRenderer = terminal.rendererCount === 0 && terminal.rendererWasAttached;
    terminal.rendererWasAttached = true;
    terminal.rendererCount += 1;
    if (replacesRenderer) {
      terminal.renderedOffset = "0";
      terminal.missedOutput = false;
      this.#restartFromRenderedOffset(terminal).catch(() => undefined);
    } else if (terminal.missedOutput || terminal.latestOffset !== terminal.renderedOffset) {
      terminal.missedOutput = false;
      this.#restartFromRenderedOffset(terminal).catch(() => undefined);
    }
    let attached = true;
    return () => {
      if (!attached) return;
      attached = false;
      terminal.rendererCount = Math.max(0, terminal.rendererCount - 1);
    };
  }

  async input(sessionId: string, text: string): Promise<void> {
    const terminal = this.#requiredLiveTerminal(sessionId);
    await terminal.connection?.input(text);
  }

  async resize(sessionId: string, cols: number, rows: number): Promise<void> {
    const terminal = this.#terminal(sessionId);
    if (terminal === null) return;
    terminal.cols = cols;
    terminal.rows = rows;
    await this.#store.upsert(this.#record(terminal));
    if (terminal.model.status === "live") await terminal.connection?.resize(cols, rows);
  }

  async retryReplay(sessionId: string): Promise<string> {
    const pending = this.#retryingReplay.get(sessionId);
    if (pending !== undefined) return pending;
    const retrying = this.#retryReplay(sessionId);
    this.#retryingReplay.set(sessionId, retrying);
    try {
      return await retrying;
    } finally {
      if (this.#retryingReplay.get(sessionId) === retrying) this.#retryingReplay.delete(sessionId);
    }
  }

  async #retryReplay(sessionId: string): Promise<string> {
    const terminal = this.#terminal(sessionId);
    if (terminal === null || terminal.model.errorCode !== "replayUnavailable")
      throw new Error("Terminal replay retry is unavailable");
    const { cwd, owner } = terminal.model;
    const generation = terminal.generation;
    await this.close(owner, sessionId);
    return this.open(owner, generation, cwd);
  }

  async close(owner: QualifiedThread, sessionId: string): Promise<void> {
    const pending = this.#closing.get(sessionId);
    if (pending !== undefined) return pending;
    const closing = this.#close(owner, sessionId);
    this.#closing.set(sessionId, closing);
    try {
      await closing;
    } finally {
      if (this.#closing.get(sessionId) === closing) this.#closing.delete(sessionId);
    }
  }

  async #close(owner: QualifiedThread, sessionId: string): Promise<void> {
    const workspace = this.#workspaces.get(terminalWorkspaceKey(owner));
    if (workspace === undefined) return;
    const index = workspace.sessions.findIndex((candidate) => candidate.model.id === sessionId);
    const terminal = workspace.sessions[index];
    if (terminal === undefined) return;
    terminal.settled = true;
    terminal.retryCancellation?.();
    terminal.connectionVersion += 1;
    await terminal.connection?.close().catch(() => undefined);
    terminal.connection = null;
    await this.#store.delete(sessionId);
    this.#outputListeners.delete(sessionId);
    workspace.sessions.splice(index, 1);
    workspace.activeId =
      workspace.activeId === sessionId
        ? (workspace.sessions[Math.min(index, workspace.sessions.length - 1)]?.model.id ?? null)
        : workspace.activeId;
    if (workspace.sessions.length === 0) {
      this.#workspaces.delete(terminalWorkspaceKey(owner));
      this.#publishOverview();
    } else {
      this.#publish(workspace);
    }
  }

  async closeSavedServer(savedServerId: SavedServerId): Promise<void> {
    const workspaces: ManagedWorkspace[] = [];
    for (const candidate of this.#workspaces.values()) {
      if (candidate.owner.savedServerId === savedServerId) workspaces.push(candidate);
    }
    for (const workspace of workspaces) await this.#closeWorkspace(workspace);
    await this.#store.deleteSavedServer(savedServerId);
  }

  async closeAll(): Promise<void> {
    if (this.#stopped) return;
    this.#stopped = true;
    for (const workspace of this.#workspaces.values()) await this.#closeWorkspace(workspace);
  }

  async #closeWorkspace(workspace: ManagedWorkspace): Promise<void> {
    while (workspace.sessions[0] !== undefined)
      await this.close(workspace.owner, workspace.sessions[0].model.id);
    this.#workspaces.delete(terminalWorkspaceKey(workspace.owner));
    this.#publishOverview();
  }

  async #connect(terminal: ManagedTerminal): Promise<void> {
    if (terminal.settled || this.#stopped) return;
    terminal.retryCancellation?.();
    terminal.retryCancellation = null;
    const pendingVersion = terminal.connectionVersion;
    let attemptVersion = pendingVersion;
    try {
      await terminal.rendering;
      if (pendingVersion !== terminal.connectionVersion || terminal.settled || this.#stopped)
        return;
      terminal.connectionVersion += 1;
      const version = terminal.connectionVersion;
      attemptVersion = version;
      this.#update(terminal, { error: null, status: "connecting" });
      const connection = await this.#transport.open(
        {
          cols: terminal.cols,
          create: terminal.createOnConnect,
          cwd: terminal.model.cwd,
          generation: terminal.generation,
          offset: terminal.renderedOffset,
          owner: terminal.model.owner,
          rows: terminal.rows,
          sessionId: terminal.model.id,
        },
        (event) => this.#receive(terminal, version, event),
      );
      if (version !== terminal.connectionVersion || terminal.settled || this.#stopped) {
        await connection.disconnect();
        return;
      }
      terminal.connection = connection;
    } catch {
      if (attemptVersion === terminal.connectionVersion) this.#scheduleReconnect(terminal);
    }
  }

  #receive(terminal: ManagedTerminal, version: number, event: TerminalTransportEvent): void {
    if (version !== terminal.connectionVersion || terminal.settled || this.#stopped) return;
    if (event.type === "opened") {
      terminal.createOnConnect = false;
      terminal.latestOffset = event.offset;
      terminal.renderedOffset = event.offset;
      terminal.reconnectAttempt = 0;
      this.#update(terminal, {
        error: null,
        errorCode: null,
        exitCode: null,
        signal: null,
        status: "live",
      });
      this.#store.upsert(this.#record(terminal)).catch(() => undefined);
      return;
    }
    if (event.type === "output") {
      if (terminal.rendererCount === 0 || !this.#emitOutput(terminal, version, event))
        terminal.missedOutput = true;
      return;
    }
    if (event.type === "exited") {
      terminal.latestOffset = event.offset;
      terminal.processExited = true;
      terminal.rendering
        .then(() =>
          this.#update(terminal, {
            error: null,
            errorCode: null,
            exitCode: event.exitCode,
            signal: event.signal,
            status: "closed",
          }),
        )
        .catch(() =>
          this.#update(terminal, {
            error: null,
            errorCode: null,
            exitCode: event.exitCode,
            signal: event.signal,
            status: "closed",
          }),
        );
      return;
    }
    if (event.type === "error") {
      terminal.settled = true;
      this.#store.delete(terminal.model.id).catch(() => undefined);
      this.#update(terminal, {
        error: event.error.message,
        errorCode: event.error.code,
        status: "failed",
      });
      return;
    }
    terminal.connection = null;
    this.#scheduleReconnect(terminal);
  }

  #emitOutput(terminal: ManagedTerminal, version: number, event: TerminalOutputEvent): boolean {
    const listener = this.#outputListeners.get(terminal.model.id);
    if (listener === undefined) return false;
    let recoveryRequired = false;
    const delivery = terminal.rendering.then(async () => {
      if (version !== terminal.connectionVersion || terminal.settled || this.#stopped) return false;
      if (compareTerminalOffset(event.nextOffset, terminal.renderedOffset) < 0)
        throw new Error("Terminal render cursor cannot move backwards");
      await listener(event);
      return true;
    });
    terminal.rendering = delivery.then(
      (applied) => {
        if (!applied || version !== terminal.connectionVersion) return;
        terminal.latestOffset = event.nextOffset;
        terminal.renderedOffset = event.nextOffset;
      },
      () => {
        if (version !== terminal.connectionVersion || terminal.settled || this.#stopped) return;
        terminal.missedOutput = true;
        terminal.connectionVersion += 1;
        recoveryRequired = true;
      },
    );
    void terminal.rendering
      .then(() => {
        if (recoveryRequired) void this.#restartFromRenderedOffset(terminal).catch(() => undefined);
      })
      .catch(() => undefined);
    return true;
  }

  #scheduleReconnect(terminal: ManagedTerminal): void {
    if (
      terminal.settled ||
      terminal.processExited ||
      this.#stopped ||
      terminal.retryCancellation !== null
    )
      return;
    terminal.reconnectAttempt += 1;
    this.#update(terminal, { error: null, status: "connecting" });
    terminal.retryCancellation = this.#lifecycle.scheduleReconnect(
      terminal.reconnectAttempt,
      () => {
        terminal.retryCancellation = null;
        this.#connect(terminal).catch(() => undefined);
      },
    );
  }

  async #restartFromRenderedOffset(terminal: ManagedTerminal): Promise<void> {
    if (terminal.settled || this.#stopped) return;
    terminal.connectionVersion += 1;
    const previous = terminal.connection;
    terminal.connection = null;
    await previous?.disconnect().catch(() => undefined);
    await this.#connect(terminal);
  }

  #requiredLiveTerminal(sessionId: string): ManagedTerminal {
    const terminal = this.#terminal(sessionId);
    if (terminal === null || terminal.model.status !== "live" || terminal.connection === null)
      throw new Error("Terminal is not open");
    return terminal;
  }

  #terminal(sessionId: string): ManagedTerminal | null {
    for (const workspace of this.#workspaces.values()) {
      const terminal = workspace.sessions.find((candidate) => candidate.model.id === sessionId);
      if (terminal !== undefined) return terminal;
    }
    return null;
  }

  #workspace(owner: QualifiedThread): ManagedWorkspace {
    const key = terminalWorkspaceKey(owner);
    const current = this.#workspaces.get(key);
    if (current !== undefined) return current;
    const workspace: ManagedWorkspace = {
      activeId: null,
      context: EMPTY_TERMINAL_CONTEXT,
      owner,
      sessions: [],
      snapshot: { activeId: null, owner, sessions: [] },
    };
    this.#workspaces.set(key, workspace);
    return workspace;
  }

  #restore(record: TerminalSessionRecord): ManagedTerminal {
    return {
      cols: record.cols,
      connection: null,
      connectionVersion: 0,
      createOnConnect: false,
      generation: record.generation,
      latestOffset: "0",
      missedOutput: false,
      model: {
        cwd: record.cwd,
        error: null,
        errorCode: null,
        exitCode: null,
        id: record.id,
        owner: record.owner,
        signal: null,
        status: "connecting",
        title: record.title,
      },
      processExited: false,
      reconnectAttempt: 0,
      renderedOffset: "0",
      rendering: Promise.resolve(),
      rendererCount: 0,
      rendererWasAttached: false,
      retryCancellation: null,
      rows: record.rows,
      settled: false,
    };
  }

  #record(terminal: ManagedTerminal): TerminalSessionRecord {
    return {
      cols: terminal.cols,
      cwd: terminal.model.cwd,
      generation: terminal.generation,
      id: terminal.model.id,
      owner: terminal.model.owner,
      rows: terminal.rows,
      title: terminal.model.title,
    };
  }

  #update(
    terminal: ManagedTerminal,
    patch: Partial<Pick<TerminalSession, "error" | "errorCode" | "exitCode" | "signal" | "status">>,
  ): void {
    terminal.model = { ...terminal.model, ...patch };
    const workspace = this.#workspaces.get(terminalWorkspaceKey(terminal.model.owner));
    if (workspace !== undefined) this.#publish(workspace);
  }

  #publish(workspace: ManagedWorkspace): void {
    let liveCount = 0;
    let errorCount = 0;
    for (const session of workspace.sessions) {
      if (session.model.status === "live") liveCount += 1;
      if (session.model.status === "failed") errorCount += 1;
    }
    workspace.context =
      workspace.sessions.length === 0
        ? EMPTY_TERMINAL_CONTEXT
        : { errorCount, liveCount, sessionCount: workspace.sessions.length };
    workspace.snapshot = {
      activeId: workspace.activeId,
      owner: workspace.owner,
      sessions: workspace.sessions.map((candidate) => candidate.model),
    };
    this.#publishOverview();
  }

  #publishOverview(): void {
    const workspaces: TerminalWorkspaceSummary[] = [];
    let sessionCount = 0;
    for (const workspace of this.#workspaces.values()) {
      if (workspace.sessions.length === 0) continue;
      const context = workspace.context;
      sessionCount += context.sessionCount;
      workspaces.push({ ...context, owner: workspace.owner });
    }
    this.#overview =
      workspaces.length === 0 ? EMPTY_TERMINAL_OVERVIEW : { sessionCount, workspaces };
    for (const listener of this.#listeners) listener();
  }
}
