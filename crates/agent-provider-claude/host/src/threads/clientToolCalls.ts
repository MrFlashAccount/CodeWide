/**
 * The companion's client tools of one thread and their in-flight calls.
 *
 * Owns the current tool set (replaced by `thread.create` / `turn.start`),
 * the binding a query registers, the `tool.call` each invocation becomes and
 * the cancellation of in-flight calls when their turn ends. A call's
 * `callId` is the `tool_use` id of the matching open item when the turn
 * already shows it (so the companion can link the call to the item), and a
 * fresh UUID otherwise.
 */

import { setImmediate as nextTick } from "node:timers/promises";
import type {
  AppThreadId,
  ClientToolSpec,
  ToolCallParams,
  ToolCallResult,
  TurnId,
} from "../protocol.js";
import type { ClientToolBinding, ClientToolInvocation } from "../claude/port.js";
import type { Logger } from "../log.js";
import { clientToolOf, qualifiedClientToolName } from "../mapping/clientTools.js";
import { toJsonValue } from "../mapping/json.js";

/** Sends one `tool.call` to the companion; resolves `success: false` once `signal` aborts. */
export type ClientToolCaller = (
  params: ToolCallParams,
  signal: AbortSignal,
) => Promise<ToolCallResult>;

/** The active turn as client tool calls see it. */
export interface ClientToolTurn {
  /** Ids of the turn's started, still open calls of the Claude tool `toolName`, oldest first. */
  readonly openToolCalls: (toolName: string) => readonly string[];
  readonly turnId: TurnId;
}

export interface ClientToolCallsDeps {
  readonly appThreadId: AppThreadId;
  readonly call: ClientToolCaller;
  readonly logger: Logger;
  readonly newUuid: () => string;
  /** The active turn, or `null` between turns. */
  readonly turn: () => ClientToolTurn | null;
}

/** Event-loop turns a call waits for its `tool_use` item before it falls back to a fresh id. */
const ITEM_WAIT_TICKS = 3;

const NO_ACTIVE_TURN: ToolCallResult = {
  content: [{ text: "No turn is active.", type: "text" }],
  success: false,
};

const sameSpecs = (left: readonly ClientToolSpec[], right: readonly ClientToolSpec[]): boolean =>
  JSON.stringify(left) === JSON.stringify(right);

export class ClientToolCalls {
  private specs: readonly ClientToolSpec[] = [];
  private readonly inFlight = new Map<string, AbortController>();
  private readonly claimed = new Set<string>();
  private readonly deps: ClientToolCallsDeps;

  public constructor(deps: ClientToolCallsDeps) {
    this.deps = deps;
  }

  /**
   * The current tool set. Its identity changes only when `replace` receives a
   * different set, so a query can tell whether it was opened with it.
   */
  public get current(): readonly ClientToolSpec[] {
    return this.specs;
  }

  /** Replaces the tool set; an equal set keeps the current one. */
  public replace(specs: readonly ClientToolSpec[]): void {
    if (!sameSpecs(this.specs, specs)) {
      this.specs = specs;
    }
  }

  /** Whether the Claude tool `toolName` is one of the current client tools. */
  public owns(toolName: string): boolean {
    const tool = clientToolOf(toolName);
    return tool !== null && this.specs.some((spec) => spec.name === tool);
  }

  /** The binding a newly opened query registers, or `null` without client tools. */
  public binding(): ClientToolBinding | null {
    if (this.specs.length === 0) {
      return null;
    }
    return {
      invoke: async (invocation) => this.invoke(invocation),
      rejected: (tool, error) => {
        this.deps.logger.log("warn", "client tool left out: unusable input schema", {
          appThreadId: this.deps.appThreadId,
          err: error,
          tool,
        });
      },
      specs: this.specs,
    };
  }

  /** Cancels every in-flight call; their results tell Claude the call was cancelled. */
  public cancelAll(): void {
    for (const controller of this.inFlight.values()) {
      controller.abort();
    }
    this.inFlight.clear();
    this.claimed.clear();
  }

  private async invoke(invocation: ClientToolInvocation): Promise<ToolCallResult> {
    const turn = this.deps.turn();
    if (turn === null) {
      return NO_ACTIVE_TURN;
    }
    const callId = await this.claimCallId(turn, invocation.tool);
    const controller = new AbortController();
    const onAbort = (): void => {
      controller.abort();
    };
    invocation.signal?.addEventListener("abort", onAbort, { once: true });
    this.inFlight.set(callId, controller);
    try {
      return await this.deps.call(
        {
          appThreadId: this.deps.appThreadId,
          arguments: toJsonValue(invocation.arguments),
          callId,
          tool: invocation.tool,
          turnId: turn.turnId,
        },
        controller.signal,
      );
    } finally {
      invocation.signal?.removeEventListener("abort", onAbort);
      this.inFlight.delete(callId);
    }
  }

  /** The oldest unclaimed open item of this tool, waiting briefly for the read loop to start it. */
  private async claimCallId(turn: ClientToolTurn, tool: string): Promise<string> {
    const toolName = qualifiedClientToolName(tool);
    for (let tick = 0; tick <= ITEM_WAIT_TICKS; tick += 1) {
      const open = turn.openToolCalls(toolName).find((id) => !this.claimed.has(id));
      if (open !== undefined) {
        this.claimed.add(open);
        return open;
      }
      // Each tick lets the session's read loop deliver the pending `tool_use` frame.
      await nextTick();
    }
    return this.deps.newUuid();
  }
}
