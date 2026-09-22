import type { Personality } from "@codewide/codex-protocol/v0.155.1";
import type {
  ReviewDelivery,
  ReviewTarget,
  Thread,
  ThreadGoal,
} from "@codewide/codex-protocol/v0.155.1/v2";

import type { GetTransferAccess } from "../../data/private-transfer";
import type { QueuedPrompt } from "../../data/thread-delivery-state";
import type {
  BackgroundTerminalValue,
  ThreadGoalInput,
  TunnelValue,
  WorkspaceResourceDatabase,
} from "../../data/workspace-resource-database";
import { RouteSessionRegistry, ROUTE_SESSION_TTL_MS } from "../routeSessionPolicy";
import { sameRouteSessionOwner, type V1RouteSessionOwner } from "../threads/threadRouteParams";

const MAX_COMPOSER_TOOL_SESSIONS = 8;

type ControlRouteRequest = {
  readonly controlError: string | null;
  readonly controlsResourceId: string | null;
  readonly getTransferAccess?: GetTransferAccess;
  readonly invokeSkill: (skill: { readonly name: string; readonly path: string }) => void;
  readonly kind: "model" | "permissions" | "skills";
  readonly newChat: boolean;
  readonly resources: WorkspaceResourceDatabase | null;
  readonly selectedEffort: string | null;
  readonly selectedModel: string | null;
  readonly selectedPermissions: string | null;
  readonly selectedPersonality: Personality | null;
  readonly selectEffort: (effort: string) => void;
  readonly selectModel: (model: string, effort: string) => void;
  readonly selectPermissions: (permissions: string | null) => void;
  readonly selectPersonality: (personality: Personality | null) => void;
  readonly thread: Thread | null;
  readonly voiceScope: string;
};

type QueueRouteRequest = {
  readonly activeTurnId: string | null;
  readonly cancel?: (commandId: string) => Promise<void>;
  readonly edit?: (item: QueuedPrompt) => void;
  readonly items: QueuedPrompt[];
  readonly kind: "queue";
  readonly move?: (commandId: string, direction: -1 | 1) => Promise<void>;
  readonly steer?: (commandId: string, expectedTurnId: string) => Promise<void>;
};

type GoalRouteRequest = {
  readonly clearGoal?: () => Promise<boolean>;
  readonly goalResourceId: string | null;
  readonly kind: "goal";
  readonly resources: WorkspaceResourceDatabase | null;
  readonly setGoal?: (input: ThreadGoalInput) => Promise<ThreadGoal>;
  readonly voiceScope: string;
};

type ReviewRouteRequest = {
  readonly kind: "review";
  readonly startReview?: (target: ReviewTarget, delivery: ReviewDelivery) => Promise<string>;
};

type PortsRouteRequest = {
  readonly connectionId: string | null;
  readonly kind: "ports";
  readonly openBrowser?: (
    title: string,
    url: string,
    headers?: Readonly<Record<string, string>>,
  ) => void;
  readonly resources: WorkspaceResourceDatabase | null;
  readonly serverName: string;
  readonly tunnelResourceId: string | null;
};

type RuntimeRouteRequest = {
  readonly backgroundTerminalsResourceId: string | null;
  readonly connectionId: string | null;
  readonly createTunnel?: (port: number, ttlSeconds: number) => Promise<TunnelValue>;
  readonly kind: "runtime";
  readonly listTerminals?: () => Promise<BackgroundTerminalValue[]>;
  readonly openBrowser?: (
    title: string,
    url: string,
    headers?: Readonly<Record<string, string>>,
  ) => void;
  readonly resources: WorkspaceResourceDatabase | null;
  readonly revokeTunnel?: (tunnelId: string) => Promise<void>;
  readonly serverName: string;
  readonly terminateTerminal?: (processId: string) => Promise<boolean>;
  readonly tunnelResourceId: string | null;
};

export type ComposerToolRouteRequest =
  | ControlRouteRequest
  | QueueRouteRequest
  | GoalRouteRequest
  | ReviewRouteRequest
  | PortsRouteRequest
  | RuntimeRouteRequest;

/** One retained composer tool activation addressed by an opaque route identifier. */
export type ComposerToolRouteSession = {
  readonly id: string;
  readonly owner: V1RouteSessionOwner;
  readonly request: ComposerToolRouteRequest;
  touchedAt: number;
};

/** Retains one activation's callbacks and sensitive tool state behind an opaque route id. */
class ComposerToolRouteSessionService {
  readonly #sessions = new RouteSessionRegistry<ComposerToolRouteSession>({
    limit: MAX_COMPOSER_TOOL_SESSIONS,
    ttlMs: ROUTE_SESSION_TTL_MS,
  });

  open(owner: V1RouteSessionOwner, request: ComposerToolRouteRequest): ComposerToolRouteSession {
    const session = {
      id: `tool-${globalThis.crypto.randomUUID()}`,
      owner,
      request,
      touchedAt: Date.now(),
    };
    this.#sessions.admit(session);
    return session;
  }

  get(id: string, owner: V1RouteSessionOwner): ComposerToolRouteSession | null {
    const session = this.#sessions.get(id);
    return session !== null && sameRouteSessionOwner(session.owner, owner) ? session : null;
  }

  retain(id: string, owner: V1RouteSessionOwner): () => void {
    return this.get(id, owner) === null ? () => undefined : this.#sessions.retain(id);
  }

  close(id: string): void {
    this.#sessions.close(id);
  }
}

export const composerToolRouteSessions = new ComposerToolRouteSessionService();
