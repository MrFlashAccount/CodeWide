/**
 * Companion-owned review drafts. A draft's destination decides which delivery
 * axes exist, so a PR axis on a session/VCS draft is unrepresentable and
 * `both` always carries both axes.
 */
import {
  diffSource,
  draftId,
  hunkFingerprint,
  hunkId,
  threadId,
  type DiffSource,
  type DraftId,
  type HunkFingerprint,
  type HunkId,
  type ThreadId,
} from "./reviewContract";
import {
  count,
  decodeOrNull,
  ForgeWireError,
  list,
  nonEmptyText,
  oneOf,
  optionalText,
  record,
  text,
} from "./forgeWire";

/** A review target at one revision (snapshot id, turn id or head revision). */
type DiffSourceRevision = { readonly revision: string; readonly source: DiffSource };

/** Line anchor of a draft; the optional hunk lets the companion move it across pushes. */
type DraftAnchor = {
  readonly endLine: number;
  readonly hunk: { readonly fingerprint: HunkFingerprint; readonly id: HunkId } | null;
  readonly path: string;
  readonly side: "new" | "old";
  readonly startLine: number;
};

/** Agent delivery axis; `sent` is terminal. */
export type AgentAxis = {
  readonly error: string | null;
  readonly state: "failed" | "pending" | "sent";
  readonly targetThreadId: ThreadId;
};

/** Forge delivery axis; `published` is terminal and makes the draft read-only. */
export type PrAxis = {
  readonly error: string | null;
  readonly state: "failed" | "outdated" | "pending" | "published" | "submitting";
};

type DraftBase = {
  readonly anchor: DraftAnchor;
  readonly author:
    | { readonly kind: "user" }
    | { readonly kind: "agent"; readonly threadId: ThreadId };
  readonly body: string;
  readonly createdAt: string;
  readonly id: DraftId;
  readonly revision: DiffSourceRevision;
  readonly updatedAt: string;
  readonly version: number;
};

/** A draft comment with exactly the axes its destination allows. */
export type DraftComment = DraftBase &
  (
    | {
        readonly agent: AgentAxis;
        readonly destination: "agent";
        readonly sourceKind: "session" | "vcs";
      }
    | {
        readonly agent: AgentAxis;
        readonly destination: "agent";
        readonly sourceKind: "pullRequest";
      }
    | { readonly destination: "pr"; readonly pr: PrAxis; readonly sourceKind: "pullRequest" }
    | {
        readonly agent: AgentAxis;
        readonly destination: "both";
        readonly pr: PrAxis;
        readonly sourceKind: "pullRequest";
      }
  );

/** Destination a user may pick; `pr` and `both` exist only for pull-request sources. */
export type DraftDestination = DraftComment["destination"];

function anchor(value: unknown, path: string): DraftAnchor {
  const entry = record(value, path);
  const startLine = count(entry.startLine, `${path}.startLine`);
  const endLine = count(entry.endLine, `${path}.endLine`);
  const hunk =
    entry.hunk === undefined || entry.hunk === null ? null : record(entry.hunk, `${path}.hunk`);
  return {
    endLine: Math.max(startLine, endLine),
    hunk:
      hunk === null
        ? null
        : {
            fingerprint: hunkFingerprint(hunk.fingerprint, `${path}.hunk.fingerprint`),
            id: hunkId(hunk.id, `${path}.hunk.id`),
          },
    path: nonEmptyText(entry.path, `${path}.path`),
    side: oneOf(entry.side, ["new", "old"], `${path}.side`),
    startLine,
  };
}

function agentAxis(value: unknown, path: string): AgentAxis {
  const axis = record(value, path);
  return {
    error: axis.error === undefined ? null : optionalText(axis.error, `${path}.error`),
    state: oneOf(axis.state, ["pending", "sent", "failed"], `${path}.state`),
    targetThreadId: threadId(axis.targetThreadId, `${path}.targetThreadId`),
  };
}

function prAxis(value: unknown, path: string): PrAxis {
  const axis = record(value, path);
  return {
    error: axis.error === undefined ? null : optionalText(axis.error, `${path}.error`),
    state: oneOf(
      axis.state,
      ["pending", "submitting", "published", "failed", "outdated"],
      `${path}.state`,
    ),
  };
}

/** Decodes one draft and rejects an axis combination its source cannot have. */
function draftComment(value: unknown, path: string): DraftComment {
  const draft = record(value, path);
  const revision = record(draft.revision, `${path}.revision`);
  const author = record(draft.author, `${path}.author`);
  const base: DraftBase = {
    anchor: anchor(draft.anchor, `${path}.anchor`),
    author:
      oneOf(author.kind, ["user", "agent"], `${path}.author.kind`) === "agent"
        ? { kind: "agent", threadId: threadId(author.threadId, `${path}.author.threadId`) }
        : { kind: "user" },
    body: text(draft.body, `${path}.body`),
    createdAt: text(draft.createdAt, `${path}.createdAt`),
    id: draftId(draft.id, `${path}.id`),
    revision: {
      revision: text(revision.revision, `${path}.revision.revision`),
      source: diffSource(revision.source, `${path}.revision.source`),
    },
    updatedAt: text(draft.updatedAt, `${path}.updatedAt`),
    version: count(draft.version, `${path}.version`),
  };
  const sourceKind = base.revision.source.kind;
  const destination = oneOf(draft.destination, ["agent", "pr", "both"], `${path}.destination`);
  if (sourceKind !== "pullRequest") {
    if (destination !== "agent") {
      throw new ForgeWireError(`${path}.destination`);
    }
    return { ...base, agent: agentAxis(draft.agent, `${path}.agent`), destination, sourceKind };
  }
  if (destination === "agent") {
    return { ...base, agent: agentAxis(draft.agent, `${path}.agent`), destination, sourceKind };
  }
  if (destination === "pr") {
    return { ...base, destination, pr: prAxis(draft.pr, `${path}.pr`), sourceKind };
  }
  return {
    ...base,
    agent: agentAxis(draft.agent, `${path}.agent`),
    destination,
    pr: prAxis(draft.pr, `${path}.pr`),
    sourceKind,
  };
}

/** `{ revision, drafts }` of `companion/review/drafts/read`. */
export type DraftsSnapshot = {
  readonly drafts: readonly DraftComment[];
  readonly revision: string;
};

/** Parses `companion/review/drafts/read`. */
export function parseDrafts(value: unknown): DraftsSnapshot | null {
  return decodeOrNull(() => {
    const result = record(value, "result");
    return {
      drafts: list(result.drafts, "drafts", draftComment),
      revision: text(result.revision, "revision"),
    };
  });
}

/** Parses the `DraftComment` result of `companion/review/draft/put`. */
export function parseDraft(value: unknown): DraftComment | null {
  return decodeOrNull(() => draftComment(value, "result"));
}

/** Per-draft outcome of `companion/review/draft/sendToAgent`. */
export type SendToAgentOutcome = readonly {
  readonly agent: "failed" | "sent";
  readonly draftId: DraftId;
  readonly error: string | null;
}[];

/** Parses `companion/review/draft/sendToAgent`. */
export function parseSendToAgent(value: unknown): SendToAgentOutcome | null {
  return decodeOrNull(() =>
    list(record(value, "result").drafts, "drafts", (item, path) => {
      const entry = record(item, path);
      return {
        agent: oneOf(entry.agent, ["sent", "failed"], `${path}.agent`),
        draftId: draftId(entry.draftId, `${path}.draftId`),
        error: optionalText(entry.error, `${path}.error`),
      };
    }),
  );
}

/** Wire input of `companion/review/draft/put`; `pr` and `both` exist only for PR sources. */
export type DraftInput = {
  readonly anchor: DraftAnchor;
  readonly body: string;
  readonly id: DraftId;
  readonly revision: DiffSourceRevision;
} & (
  | { readonly destination: "agent"; readonly targetThreadId: ThreadId }
  | { readonly destination: "pr" }
  | { readonly destination: "both"; readonly targetThreadId: ThreadId }
);
