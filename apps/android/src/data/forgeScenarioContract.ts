/**
 * `companion/pullRequest/scenarios/read`: the Companion's live state of a PR's agent scenario
 * slots. A slot is one intent (scenario kind plus its `checkId` or `reviewThreadId`); a slot the
 * Companion does not list is idle. The read is prompt-free: ids, RFC 3339 times and a failure
 * reason only.
 */
import { headRevision, type HeadRevision } from "./forgeContract";
import {
  decodeOrNull,
  ForgeWireError,
  list,
  nonEmptyText,
  oneOf,
  optionalText,
  record,
  text,
} from "./forgeWire";
import { threadId, type ThreadId } from "./reviewContract";

/** Scenario kinds that own a deduplicated slot; `message` has none. */
export type SlotScenarioKind = "addressComments" | "fixCi" | "rebase" | "reviewPr";

/** Where the latest run of one slot stands. A run belongs to the head it started at. */
type ScenarioRunState =
  | { readonly status: "idle" }
  | {
      readonly headRevision: HeadRevision;
      readonly queuedAt: string;
      readonly status: "queued";
      readonly threadId: ThreadId;
    }
  | {
      readonly headRevision: HeadRevision;
      readonly startedAt: string;
      readonly status: "running";
      readonly threadId: ThreadId;
    }
  | {
      readonly finishedAt: string;
      readonly headRevision: HeadRevision;
      readonly status: "done";
      readonly threadId: ThreadId;
    }
  | {
      readonly finishedAt: string | null;
      readonly headRevision: HeadRevision;
      readonly reason: string;
      readonly status: "failed";
      readonly threadId: ThreadId;
    };

/** One slot and its latest run. */
export type ScenarioSlotState = {
  readonly checkId: string | null;
  readonly reviewThreadId: string | null;
  readonly scenario: SlotScenarioKind;
  readonly state: ScenarioRunState;
};

/** Every slot of one PR with a recorded run. */
export type PullRequestScenarios = {
  readonly scenarios: readonly ScenarioSlotState[];
};

/** An RFC 3339 time the client can age; an unparsable value is a contract violation. */
function time(value: unknown, path: string): string {
  const result = nonEmptyText(value, path);
  if (Number.isNaN(Date.parse(result))) {
    throw new ForgeWireError(path);
  }
  return result;
}

function runState(value: unknown, path: string): ScenarioRunState {
  const state = record(value, path);
  const status = oneOf(
    state.status,
    ["idle", "queued", "running", "done", "failed"],
    `${path}.status`,
  );
  if (status === "idle") {
    return { status };
  }
  const run = {
    headRevision: headRevision(state.headRevision, `${path}.headRevision`),
    threadId: threadId(state.threadId, `${path}.threadId`),
  };
  if (status === "queued") {
    return { ...run, queuedAt: time(state.queuedAt, `${path}.queuedAt`), status };
  }
  if (status === "running") {
    return { ...run, startedAt: time(state.startedAt, `${path}.startedAt`), status };
  }
  if (status === "done") {
    return { ...run, finishedAt: time(state.finishedAt, `${path}.finishedAt`), status };
  }
  return {
    ...run,
    finishedAt: state.finishedAt === null ? null : time(state.finishedAt, `${path}.finishedAt`),
    reason: text(state.reason, `${path}.reason`),
    status,
  };
}

/** Parses `companion/pullRequest/scenarios/read`; a contract mismatch is `null`. */
export function parsePullRequestScenarios(value: unknown): PullRequestScenarios | null {
  return decodeOrNull(() => ({
    scenarios: list(record(value, "result").scenarios, "scenarios", (entry, path) => {
      const slot = record(entry, path);
      return {
        checkId: optionalText(slot.checkId, `${path}.checkId`),
        reviewThreadId: optionalText(slot.reviewThreadId, `${path}.reviewThreadId`),
        scenario: oneOf(
          slot.scenario,
          ["addressComments", "fixCi", "rebase", "reviewPr"],
          `${path}.scenario`,
        ),
        state: runState(slot.state, `${path}.state`),
      };
    }),
  }));
}
