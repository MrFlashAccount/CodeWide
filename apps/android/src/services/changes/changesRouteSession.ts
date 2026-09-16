import type { Thread } from "@codewide/codex-protocol/v0.147.0/v2";

import type { GetTransferAccess } from "../../data/private-transfer";
import type { ThreadChangeDiffValue } from "../../data/thread-resource-types";
import type {
  ThreadChangeScope,
  ThreadResourcesValue,
} from "../../data/workspace-resource-database";
import type { CodeReviewComment } from "../../rendering/code-review";
import type { TurnChangedFile } from "../../rendering/turn-changes";
import type { TurnChangesTarget } from "../../rendering/TurnChangesContext";
import type { AppVoiceInputRuntime } from "../../ui/VoiceInputRuntime";
import type { ChangesPreferences } from "../../features/changes/changePresentation";
import type { DocumentPreviewRequest } from "../../rendering/DocumentPreviewHost";
import type { CodeReviewFileResource } from "../../features/review/code-review-files";
import { RouteSessionRegistry, ROUTE_SESSION_TTL_MS } from "../routeSessionPolicy";
import { sameRouteSessionOwner, type V1RouteSessionOwner } from "../threads/threadRouteParams";

const MAX_CHANGE_SESSIONS = 6;

type SharedChangeRouteRequest = {
  readonly attachCodeReview: (comments: readonly CodeReviewComment[]) => Promise<boolean>;
  readonly cwd: string;
  readonly getTransferAccess: GetTransferAccess;
  readonly thread: Thread | null;
  readonly voiceRuntime: AppVoiceInputRuntime;
};

export type CurrentChangesRouteRequest = SharedChangeRouteRequest & {
  readonly initialResource: ThreadResourcesValue | null;
  readonly kind: "current";
  readonly loadDiff?: (path: string, scope?: ThreadChangeScope) => Promise<ThreadChangeDiffValue>;
  readonly loadResources?: (
    scope?: ThreadChangeScope,
    kind?: "all" | "changes" | "attachments",
  ) => Promise<ThreadResourcesValue>;
  readonly preferences: ChangesPreferences;
  readonly setPreferences: (preferences: ChangesPreferences) => void;
};

export type TurnChangesRouteRequest = SharedChangeRouteRequest & {
  readonly kind: "turn";
  readonly knownFiles: readonly TurnChangedFile[];
  readonly loadTurnChanges?: (target: TurnChangesTarget) => Promise<readonly TurnChangedFile[]>;
  readonly target: TurnChangesTarget;
  readonly wrapLines: boolean;
};

export type CodeDocumentRouteRequest = SharedChangeRouteRequest & {
  readonly changeScope: ThreadChangeScope | undefined;
  readonly document: DocumentPreviewRequest;
  readonly files: readonly CodeReviewFileResource[];
  readonly kind: "codeDocument";
  readonly loadDiff?: (path: string, scope?: ThreadChangeScope) => Promise<ThreadChangeDiffValue>;
};

type ChangesRouteRequest =
  | CurrentChangesRouteRequest
  | TurnChangesRouteRequest
  | CodeDocumentRouteRequest;

/** One retained review request addressed by an opaque route identifier. */
type ChangesRouteSession = {
  readonly id: string;
  readonly owner: V1RouteSessionOwner;
  readonly request: ChangesRouteRequest;
  touchedAt: number;
};

/** Retains review commands and private resources outside typed route parameters. */
class ChangesRouteSessionService {
  readonly #sessions = new RouteSessionRegistry<ChangesRouteSession>({
    limit: MAX_CHANGE_SESSIONS,
    ttlMs: ROUTE_SESSION_TTL_MS,
  });

  open(owner: V1RouteSessionOwner, request: ChangesRouteRequest): ChangesRouteSession {
    const session = {
      id: `changes-${globalThis.crypto.randomUUID()}`,
      owner,
      request,
      touchedAt: Date.now(),
    };
    this.#sessions.admit(session);
    return session;
  }

  get(id: string, owner: V1RouteSessionOwner): ChangesRouteSession | null {
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

export const changesRouteSessions = new ChangesRouteSessionService();
