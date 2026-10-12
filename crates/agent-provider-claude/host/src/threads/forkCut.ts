/**
 * Where a fork cuts a thread's session chain. A thread's turns can span
 * several sessions (a replacement session continues a lost one); a fork
 * copies every session before the boundary entirely and the session holding
 * the boundary through the boundary's last message. Pure; no I/O.
 */

import { turnEnds } from "../history/reconstruct.js";
import type { TurnRecord } from "../state/threadState.js";

/** How much of the source thread the fork keeps. */
export type ForkBoundary =
  | { readonly kind: "all" }
  | { readonly kind: "before"; readonly turnId: string }
  | { readonly kind: "through"; readonly turnId: string };

/** One session of the source chain with its stored messages. */
export interface ChainSession {
  readonly messages: readonly unknown[];
  readonly sessionId: string;
}

/** One session to copy: entirely (`upToMessageId: null`) or through that message. */
export interface SessionCut {
  readonly sessionId: string;
  readonly upToMessageId: string | null;
}

export type ForkCut =
  | { readonly kind: "cut"; readonly sessions: readonly [SessionCut, ...SessionCut[]] }
  | { readonly kind: "nothingBefore" }
  | { readonly kind: "unknownTurn" };

const uuidOf = (message: unknown): unknown =>
  typeof message === "object" && message !== null ? Reflect.get(message, "uuid") : undefined;

/** The sessions to copy, oldest first, for `boundary`. */
export function forkCut(
  chain: readonly [ChainSession, ...ChainSession[]],
  records: readonly TurnRecord[],
  boundary: ForkBoundary,
): ForkCut {
  if (boundary.kind === "all") {
    const [first, ...rest] = chain;
    return {
      kind: "cut",
      sessions: [
        { sessionId: first.sessionId, upToMessageId: null },
        ...rest.map((session) => ({ sessionId: session.sessionId, upToMessageId: null })),
      ],
    };
  }
  const ends = turnEnds(
    chain.flatMap((session) => session.messages),
    records,
  );
  const index = ends.findIndex((end) => end.turnId === boundary.turnId);
  if (index === -1) {
    return { kind: "unknownTurn" };
  }
  const end = ends[boundary.kind === "through" ? index : index - 1];
  if (end === undefined) {
    return { kind: "nothingBefore" };
  }
  const holder = chain.findIndex((session) =>
    session.messages.some((message) => uuidOf(message) === end.lastUuid),
  );
  const [first, ...rest] = chain.slice(0, holder + 1);
  if (first === undefined) {
    return { kind: "unknownTurn" };
  }
  const sessions: [SessionCut, ...SessionCut[]] = [
    { sessionId: first.sessionId, upToMessageId: rest.length === 0 ? end.lastUuid : null },
    ...rest.map((session, position) => ({
      sessionId: session.sessionId,
      upToMessageId: position === rest.length - 1 ? end.lastUuid : null,
    })),
  ];
  return { kind: "cut", sessions };
}
