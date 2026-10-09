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
  | { readonly kind: "reasoning"; readonly text: string; readonly summaryIndex: number }
  | { readonly kind: "output"; readonly text: string }
  | { readonly kind: "fileChanges"; readonly changes: readonly FileChange[] };

export type AgentEvent =
  | { readonly type: "thread.updated"; readonly thread: AgentThread }
  | { readonly type: "turn.started"; readonly appThreadId: AppThreadId; readonly turn: AgentTurn }
  | { readonly type: "turn.completed"; readonly appThreadId: AppThreadId; readonly turn: AgentTurn }
  | {
      readonly type: "item.started";
      readonly appThreadId: AppThreadId;
      readonly turnId: TurnId;
      readonly item: AgentItem;
    }
  | {
      readonly type: "item.delta";
      readonly appThreadId: AppThreadId;
      readonly turnId: TurnId;
      readonly itemId: ItemId;
      readonly delta: ItemDelta;
    }
  | {
      readonly type: "item.completed";
      readonly appThreadId: AppThreadId;
      readonly turnId: TurnId;
      readonly item: AgentItem;
    }
  | {
      readonly type: "request.opened";
      readonly appThreadId: AppThreadId;
      readonly turnId: TurnId;
      readonly requestId: NativeRequestId;
      readonly request: RuntimeRequest;
    }
  | {
      readonly type: "request.resolved";
      readonly appThreadId: AppThreadId;
      readonly requestId: NativeRequestId;
      readonly reason: RequestResolution;
    }
  | {
      readonly type: "usage.updated";
      readonly appThreadId: AppThreadId;
      readonly turnId: TurnId;
      readonly last: TokenUsage;
      readonly total: TokenUsage;
      readonly contextWindow: number | null;
    }
  | {
      readonly type: "plan.updated";
      readonly appThreadId: AppThreadId;
      readonly turnId: TurnId;
      readonly explanation: string | null;
      readonly plan: readonly PlanStep[];
    }
  | {
      readonly type: "diff.updated";
      readonly appThreadId: AppThreadId;
      readonly turnId: TurnId;
      readonly diff: string;
    }
  | {
      readonly type: "capability.event";
      readonly appThreadId: AppThreadId | null;
      readonly capability: string;
      readonly payload: JsonValue;
    };

export type AgentEventType = AgentEvent["type"];
