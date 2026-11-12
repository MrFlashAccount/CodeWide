import type { CommandOutputReference } from "@codewide/sync-client";

import type { GetTransferAccess } from "../data/private-transfer";
import { checkAborted } from "../native/check-aborted";
import { readCommandOutput } from "./command-output-resource";

/**
 * What a command output viewer shows. A running command's output only grows,
 * so `totalChars` counts every character read in this `generation`, also
 * those no longer kept; a viewer appends what that count grew by. Output that
 * does not extend the previous text (a finished command's single aggregated
 * segment) starts a new generation, which a viewer shows from scratch.
 */
export interface FollowedCommandOutput {
  readonly generation: number;
  readonly headOmitted: boolean;
  readonly text: string;
  readonly totalChars: number;
}

/** The most text a live-growing output keeps; its beginning goes first. */
export const COMMAND_FOLLOW_RESIDENT_CHARS = 1_048_576;

/** How often a burst of new segments is published, at most. */
const PUBLISH_INTERVAL_MS = 100;

/** Followed outputs kept for reopening; the least recently read goes first. */
const MAX_FOLLOWED_OUTPUTS = 4;

/**
 * The read prefix of one followed output: which segments its text holds, in
 * order. `settled` means the generation once read every segment it was asked
 * for, so later segments are live growth, which alone may drop the beginning:
 * a finished command opened afresh always shows its complete output.
 */
interface FollowState {
  readonly output: FollowedCommandOutput;
  /**
   * The generation's append-only id buffer, shared by its successive states;
   * a state holds its first `segmentCount` ids. Only the newest state of a
   * key appends, so the buffer never holds ids past a stale state's count
   * that the newest one lacks.
   */
  readonly referenceIds: string[];
  readonly segmentCount: number;
  readonly settled: boolean;
}

/**
 * The read prefixes by viewer key. A viewer revision changes with every new
 * segment and replaces (aborts) the read of the previous one, so the progress
 * lives here, not in the revision: each read continues where any earlier one
 * stopped, instead of reading every segment again from the start.
 */
const follows = new Map<string, FollowState>();

export interface FollowCommandOutputRequest {
  readonly getTransferAccess: GetTransferAccess;
  /** The viewer's key; it already names the private file access scope. */
  readonly key: string;
  readonly now?: () => number;
  readonly publish: (output: FollowedCommandOutput) => void;
  readonly references: readonly CommandOutputReference[];
  readonly scope: string;
  readonly signal: AbortSignal;
}

/**
 * Reads the segments of `references` the key's prefix does not hold yet,
 * one segment at a time, so the work per update is the new output only and
 * an aborted read loses at most the segment in flight. Concurrent reads of
 * one key never apply a segment twice: a read that finds the prefix advanced
 * by another continues from that prefix, and one whose output a newer read
 * replaced stops.
 */
export async function followCommandOutput(
  request: FollowCommandOutputRequest,
): Promise<FollowedCommandOutput> {
  let state = startingState(follows.get(request.key), request.references);
  store(request.key, state);
  const publisher = new ThrottledPublisher(request.publish, request.now ?? Date.now);
  // An empty new generation is not published: the viewer keeps the text it
  // shows (the previous revision's) until the new one has read something.
  if (state.segmentCount > 0) {
    publisher.publish(state.output);
  }
  try {
    while (state.segmentCount < request.references.length) {
      const step = await readNextSegment(request, state);
      if (step.kind === "replaced") {
        return step.output;
      }
      state = step.state;
      publisher.publish(state.output);
    }
  } finally {
    publisher.cancel();
  }
  if (!state.settled && follows.get(request.key) === state) {
    state = { ...state, settled: true };
    store(request.key, state);
  }
  publisher.flush(state.output);
  return state.output;
}

/** A read step: the prefix to continue from, or a newer read's replacement. */
type FollowStep =
  | { readonly kind: "next"; readonly state: FollowState }
  | { readonly kind: "replaced"; readonly output: FollowedCommandOutput };

/**
 * Reads the segment after `state`'s prefix and applies it, unless another
 * read advanced the prefix meanwhile: then the step continues from that
 * prefix when it is the same generation, else a newer read replaced the
 * output and owns the key.
 */
async function readNextSegment(
  request: FollowCommandOutputRequest,
  state: FollowState,
): Promise<FollowStep> {
  const reference = request.references[state.segmentCount];
  if (reference === undefined) {
    return { kind: "replaced", output: state.output };
  }
  const page = await readCommandOutput(
    {
      byteLimit: reference.byteLength,
      getTransferAccess: request.getTransferAccess,
      references: [reference],
      scope: request.scope,
    },
    request.signal,
  );
  checkAborted(request.signal);
  const current = follows.get(request.key);
  if (current === state) {
    const next = appended(state, reference.id, page.text);
    store(request.key, next);
    return { kind: "next", state: next };
  }
  // A generation only ever extends its own prefix, so a newer state of the
  // same generation is this output's; another generation replaced it.
  if (current === undefined || current.output.generation !== state.output.generation) {
    return { kind: "replaced", output: current?.output ?? state.output };
  }
  return { kind: "next", state: current };
}

/**
 * Publishes at most once per interval: the first output at once, a burst's
 * later ones when the interval has passed, even if no further segment comes.
 */
class ThrottledPublisher {
  private readonly emit: (output: FollowedCommandOutput) => void;
  private readonly now: () => number;
  private last: FollowedCommandOutput | null = null;
  private pending: FollowedCommandOutput | null = null;
  private publishedAt = Number.NEGATIVE_INFINITY;
  private timer: ReturnType<typeof setTimeout> | null = null;

  constructor(emit: (output: FollowedCommandOutput) => void, now: () => number) {
    this.emit = emit;
    this.now = now;
  }

  publish(output: FollowedCommandOutput): void {
    const wait = this.publishedAt + PUBLISH_INTERVAL_MS - this.now();
    if (wait <= 0) {
      this.send(output);
      return;
    }
    this.pending = output;
    this.timer ??= setTimeout(() => {
      this.timer = null;
      if (this.pending !== null) {
        this.send(this.pending);
      }
    }, wait);
  }

  /** Publishes the final output unless it is the one already published. */
  flush(output: FollowedCommandOutput): void {
    this.cancel();
    if (this.last !== output) {
      this.send(output);
    }
  }

  cancel(): void {
    if (this.timer !== null) {
      clearTimeout(this.timer);
      this.timer = null;
    }
    this.pending = null;
  }

  private send(output: FollowedCommandOutput): void {
    this.pending = null;
    this.last = output;
    this.publishedAt = this.now();
    this.emit(output);
  }
}

/** Forgets every followed output; for tests. */
export function resetFollowedCommandOutputs(): void {
  follows.clear();
}

/**
 * Where a read of `references` starts: the stored prefix when they extend it
 * (or when an older revision asks for less than it holds), else an empty new
 * generation.
 */
function startingState(
  previous: FollowState | undefined,
  references: readonly CommandOutputReference[],
): FollowState {
  if (previous !== undefined && extendsPrefix(previous, references)) {
    return previous;
  }
  return {
    output: {
      generation: (previous?.output.generation ?? 0) + 1,
      headOmitted: false,
      text: "",
      totalChars: 0,
    },
    referenceIds: [],
    segmentCount: 0,
    settled: false,
  };
}

/** Whether the state's segments and `references` agree as far as both go. */
function extendsPrefix(state: FollowState, references: readonly CommandOutputReference[]): boolean {
  return sharesPrefix(state.referenceIds, state.segmentCount, references);
}

/** Whether the shorter of the two id lists is a prefix of the longer one. */
function sharesPrefix(
  ids: readonly string[],
  count: number,
  references: readonly CommandOutputReference[],
): boolean {
  const length = Math.min(count, references.length);
  for (let index = 0; index < length; index += 1) {
    if (ids[index] !== references[index]?.id) {
      return false;
    }
  }
  return true;
}

/** The state with one more segment; live growth keeps the newest lines only. */
function appended(state: FollowState, referenceId: string, text: string): FollowState {
  const joined = state.output.text + text;
  const overflow = state.settled ? joined.length - COMMAND_FOLLOW_RESIDENT_CHARS : 0;
  const lineStart = overflow > 0 ? joined.indexOf("\n", overflow) : -1;
  const kept = overflow > 0 ? joined.slice(lineStart < 0 ? overflow : lineStart + 1) : joined;
  return {
    output: {
      generation: state.output.generation,
      headOmitted: state.output.headOmitted || overflow > 0,
      text: kept,
      totalChars: state.output.totalChars + text.length,
    },
    referenceIds: appendId(state, referenceId),
    segmentCount: state.segmentCount + 1,
    settled: state.settled,
  };
}

/** Appends to the generation's shared buffer instead of copying it per segment. */
function appendId(state: FollowState, referenceId: string): string[] {
  const ids = state.referenceIds;
  ids.length = state.segmentCount;
  ids.push(referenceId);
  return ids;
}

function store(key: string, state: FollowState): void {
  follows.delete(key);
  follows.set(key, state);
  for (const oldest of follows.keys()) {
    if (follows.size <= MAX_FOLLOWED_OUTPUTS) {
      break;
    }
    follows.delete(oldest);
  }
}
