/**
 * Events a provider emits, in order, over the `event` notification.
 *
 * Events of one thread are totally ordered by the provider. Every event names
 * its `appThreadId`; `capability.event` may be connection-scoped (`null`).
 */

import type { AppThreadId, ItemId, NativeRequestId, TurnId } from "./ids";
import type {
  AgentItem,
  AgentThread,
  AgentTurn,
  FileChange,
  JsonValue,
  PlanStep,
  RequestResolution,
  RuntimeRequest,
  TokenUsage,
} from "./model";

/** Incremental content for an item that is still in progress. */
export type ItemDelta =
  | { readonly kind: "text"; readonly text: string }
  | { readonly kind: "reasoning"; readonly summaryIndex: number; readonly text: string }
  | { readonly kind: "output"; readonly text: string }
  | { readonly changes: readonly FileChange[]; readonly kind: "fileChanges" };

export type AgentEvent =
  | { readonly thread: AgentThread; readonly type: "thread.updated" }
  | { readonly appThreadId: AppThreadId; readonly turn: AgentTurn; readonly type: "turn.started" }
  | { readonly appThreadId: AppThreadId; readonly turn: AgentTurn; readonly type: "turn.completed" }
  | {
      readonly appThreadId: AppThreadId;
      readonly item: AgentItem;
      readonly turnId: TurnId;
      readonly type: "item.started";
    }
  | {
      readonly appThreadId: AppThreadId;
      readonly delta: ItemDelta;
      readonly itemId: ItemId;
      readonly turnId: TurnId;
      readonly type: "item.delta";
    }
  | {
      readonly appThreadId: AppThreadId;
      readonly item: AgentItem;
      readonly turnId: TurnId;
      readonly type: "item.completed";
    }
  | {
      readonly appThreadId: AppThreadId;
      readonly request: RuntimeRequest;
      readonly requestId: NativeRequestId;
      readonly turnId: TurnId;
      readonly type: "request.opened";
    }
  | {
      readonly appThreadId: AppThreadId;
      readonly reason: RequestResolution;
      readonly requestId: NativeRequestId;
      readonly type: "request.resolved";
    }
  | {
      readonly appThreadId: AppThreadId;
      readonly contextWindow: number | null;
      readonly last: TokenUsage;
      readonly total: TokenUsage;
      readonly turnId: TurnId;
      readonly type: "usage.updated";
    }
  | {
      readonly appThreadId: AppThreadId;
      readonly explanation: string | null;
      readonly plan: readonly PlanStep[];
      readonly turnId: TurnId;
      readonly type: "plan.updated";
    }
  | {
      readonly appThreadId: AppThreadId;
      readonly diff: string;
      readonly turnId: TurnId;
      readonly type: "diff.updated";
    }
  | {
      readonly appThreadId: AppThreadId | null;
      readonly capability: string;
      readonly payload: JsonValue;
      readonly type: "capability.event";
    };

export type AgentEventType = AgentEvent["type"];
