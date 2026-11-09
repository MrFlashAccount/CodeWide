import type { CommandOutputReference } from "@codewide/sync-client";
import type { RenderContentReference } from "@codewide/renderers";
import type { GetTransferAccess } from "../../data/private-transfer";
import { RouteSessionRegistry, ROUTE_SESSION_TTL_MS } from "../routeSessionPolicy";
import { sameRouteSessionOwner, type V1RouteSessionOwner } from "../threads/threadRouteParams";

const MAX_CONTENT_SESSIONS = 4;

export type ContentPresentation = "markdown" | "terminal" | "text";

/**
 * One part of a content document: text the item holds inline, or a field the
 * Companion keeps out of line, which the viewer reads chunk by chunk.
 */
export type ContentDocumentPart =
  | {
      readonly kind: "inline";
      readonly label: string;
      readonly presentation: ContentPresentation;
      readonly text: string;
    }
  | {
      readonly kind: "reference";
      readonly label: string;
      readonly presentation: ContentPresentation;
      readonly reference: RenderContentReference;
    };

/** Everything one item shows in the full-screen viewer, in reading order. */
export type DocumentContentRouteRequest = {
  /** Reads the out-of-line parts; null without a connection. */
  readonly getTransferAccess: GetTransferAccess | null;
  readonly kind: "document";
  readonly parts: readonly [ContentDocumentPart, ...ContentDocumentPart[]];
  readonly title: string;
};

export type CommandContentRouteRequest = {
  /**
   * The command as launched, shown when its thread holds the item no longer;
   * a preview when the Companion externalized the command.
   */
  readonly command: string;
  /** The opened item's externalized command, read when its thread holds the item no longer. */
  readonly commandReference: CommandOutputReference | null;
  readonly fallbackOutput: string;
  /** Reads output the Companion externalized as private content; null without a connection. */
  readonly getTransferAccess: GetTransferAccess | null;
  readonly itemId: string;
  readonly kind: "command";
  /** The opened item's output segments, read when its thread holds the item no longer. */
  readonly references: readonly CommandOutputReference[];
  /**
   * The thread that owns the item: a subagent's own thread when opened from its
   * conversation, not the thread whose route presents the viewer.
   */
  readonly threadId: string;
  readonly turnId: string;
};

export type LargeContentRouteRequest = DocumentContentRouteRequest | CommandContentRouteRequest;

/** One retained large-content request addressed by an opaque route identifier. */
type ContentRouteSession = {
  readonly id: string;
  readonly owner: V1RouteSessionOwner;
  readonly request: LargeContentRouteRequest;
  touchedAt: number;
};

/** Retains one private large-content request behind a bounded opaque route id. */
class ContentRouteSessionService {
  readonly #sessions = new RouteSessionRegistry<ContentRouteSession>({
    limit: MAX_CONTENT_SESSIONS,
    ttlMs: ROUTE_SESSION_TTL_MS,
  });

  open(owner: V1RouteSessionOwner, request: LargeContentRouteRequest): ContentRouteSession {
    const session = {
      id: `content-${globalThis.crypto.randomUUID()}`,
      owner,
      request,
      touchedAt: Date.now(),
    };
    this.#sessions.admit(session);
    return session;
  }

  get(id: string, owner: V1RouteSessionOwner): ContentRouteSession | null {
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

export const contentRouteSessions = new ContentRouteSessionService();
