/**
 * Builds one neutral turn from classified Claude frames.
 *
 * Owns the neutral ordering invariants of a single turn:
 * 1. `turn.started` precedes every item event;
 * 2. a user turn's first item is its `userMessage`;
 * 3. every started item is completed before `turn.completed`;
 * 4. at most one `agentMessage` has phase `final`: the latest completed agent
 *    message is held back and released as `commentary` when another item
 *    starts, or as `final` when the turn completes successfully;
 * 5. `item.completed` carries the full item; deltas only reference started,
 *    still-open items of the matching type.
 * Holds state but performs no I/O; the session decides what to do with the
 * events it returns.
 */

import type {
  AgentEvent,
  AgentItem,
  AgentTurn,
  AppThreadId,
  ClientMessageId,
  ItemId,
  TokenUsage,
  TurnError,
  TurnId,
  TurnOrigin,
  UserContent,
} from "../protocol.js";
import { asItemId } from "../protocol.js";
import type { ClaudeFrame, JsonRecord } from "../mapping/frames.js";
import {
  blockItemId,
  completeItem,
  executionStatus,
  failOpenItem,
  imageViewFor,
  startItem,
  todoPlan,
  toolDisposition,
} from "../mapping/tools.js";
import type { TurnOutcome } from "../mapping/result.js";

interface ItemSlot {
  item: AgentItem;
  completed: boolean;
}

interface ToolCall {
  readonly name: string;
  readonly input: JsonRecord;
  readonly startedAtMs: number;
}

export interface TurnBuilderContext {
  readonly appThreadId: AppThreadId;
  readonly turnId: TurnId;
  readonly origin: TurnOrigin;
  readonly cwd: string;
  readonly nowMs: () => number;
}

const seconds = (ms: number): number => Math.floor(ms / 1000);

export class TurnBuilder {
  private readonly slots = new Map<string, ItemSlot>();
  private readonly order: string[] = [];
  private readonly tools = new Map<string, ToolCall>();
  private readonly declined = new Set<string>();
  private readonly snapshotOrdinals = new Map<string, number>();
  private readonly streamBlocks = new Map<number, ItemId>();
  private currentMessageId: string | null = null;
  private heldAgentMessage: string | null = null;
  private userMessageCount = 0;
  private lastAssistantError: string | null = null;
  private mcpServers: readonly string[] = [];
  readonly startedAt: number;

  constructor(private readonly context: TurnBuilderContext) {
    this.startedAt = seconds(context.nowMs());
  }

  get turnId(): TurnId {
    return this.context.turnId;
  }

  get origin(): TurnOrigin {
    return this.context.origin;
  }

  /** `error` field of the most recent top-level assistant frame. */
  get assistantError(): string | null {
    return this.lastAssistantError;
  }

  /** Whether a command (Bash) item is still running; used by the interrupt fallback. */
  get hasRunningCommand(): boolean {
    return [...this.slots.values()].some((slot) => !slot.completed && slot.item.type === "command");
  }

  setMcpServers(servers: readonly string[]): void {
    this.mcpServers = servers;
  }

  private turnShape(status: AgentTurn["status"], items: readonly AgentItem[], completedAt: number | null, error: TurnError | null): AgentTurn {
    return {
      turnId: this.context.turnId,
      status,
      origin: this.context.origin,
      startedAt: this.startedAt,
      completedAt,
      error,
      items,
    };
  }

  /** `turn.started` plus, for a user turn, its first `userMessage`. */
  begin(userMessage: { readonly clientMessageId: ClientMessageId | null; readonly content: readonly UserContent[] } | null): AgentEvent[] {
    const events: AgentEvent[] = [{ type: "turn.started", appThreadId: this.context.appThreadId, turn: this.turnShape("inProgress", [], null, null) }];
    if (userMessage !== null) events.push(...this.addUserMessage(userMessage.clientMessageId, userMessage.content));
    return events;
  }

  /** A user message inside this turn (the first one, or an explicit steer). */
  addUserMessage(clientMessageId: ClientMessageId | null, content: readonly UserContent[]): AgentEvent[] {
    const itemId = asItemId(`${this.context.turnId}:user:${this.userMessageCount}`);
    this.userMessageCount += 1;
    const item: AgentItem = { type: "userMessage", itemId, clientMessageId, content };
    return [...this.start(item), ...this.complete(item)];
  }

  private event(type: "item.started" | "item.completed", item: AgentItem): AgentEvent {
    return { type, appThreadId: this.context.appThreadId, turnId: this.context.turnId, item };
  }

  private flushHeld(phase: "commentary" | "final"): AgentEvent[] {
    const held = this.heldAgentMessage;
    if (held === null) return [];
    this.heldAgentMessage = null;
    const slot = this.slots.get(held);
    if (slot === undefined || slot.item.type !== "agentMessage") return [];
    slot.item = { ...slot.item, phase };
    slot.completed = true;
    return [this.event("item.completed", slot.item)];
  }

  private start(item: AgentItem): AgentEvent[] {
    if (this.slots.has(item.itemId)) return [];
    const events = this.flushHeld("commentary");
    this.slots.set(item.itemId, { item, completed: false });
    this.order.push(item.itemId);
    events.push(this.event("item.started", item));
    return events;
  }

  private complete(item: AgentItem): AgentEvent[] {
    const slot = this.slots.get(item.itemId);
    if (slot === undefined || slot.completed) return [];
    slot.item = item;
    if (item.type === "agentMessage") {
      const events = this.heldAgentMessage === item.itemId ? [] : this.flushHeld("commentary");
      this.heldAgentMessage = item.itemId;
      return events;
    }
    slot.completed = true;
    return [this.event("item.completed", item)];
  }

  private delta(itemId: ItemId, type: "agentMessage" | "reasoning", text: string): AgentEvent[] {
    const slot = this.slots.get(itemId);
    if (slot === undefined || slot.completed || this.heldAgentMessage === itemId || slot.item.type !== type || text.length === 0) {
      return [];
    }
    if (slot.item.type === "agentMessage") {
      slot.item = { ...slot.item, text: slot.item.text + text };
      return [{ type: "item.delta", appThreadId: this.context.appThreadId, turnId: this.context.turnId, itemId, delta: { kind: "text", text } }];
    }
    if (slot.item.type === "reasoning") {
      const summary = slot.item.summary[0] ?? "";
      slot.item = { ...slot.item, summary: [summary + text] };
      return [
        {
          type: "item.delta",
          appThreadId: this.context.appThreadId,
          turnId: this.context.turnId,
          itemId,
          delta: { kind: "reasoning", text, summaryIndex: 0 },
        },
      ];
    }
    return [];
  }

  private startBlock(itemId: ItemId, kind: "text" | "thinking"): AgentEvent[] {
    const item: AgentItem =
      kind === "text"
        ? { type: "agentMessage", itemId, text: "", phase: "commentary" }
        : { type: "reasoning", itemId, summary: [], content: [] };
    return this.start(item);
  }

  /** Starts the item of a tool call if it has not started yet (from a snapshot or `canUseTool`). */
  startTool(toolUseId: string, name: string, input: JsonRecord): AgentEvent[] {
    if (this.tools.has(toolUseId)) return [];
    this.tools.set(toolUseId, { name, input, startedAtMs: this.context.nowMs() });
    const disposition = toolDisposition(name);
    if (disposition.type === "plan") {
      return [
        {
          type: "plan.updated",
          appThreadId: this.context.appThreadId,
          turnId: this.context.turnId,
          explanation: null,
          plan: todoPlan(input),
        },
      ];
    }
    if (disposition.type === "exitPlan") {
      const plan = typeof input["plan"] === "string" ? input["plan"] : "";
      const item: AgentItem = { type: "plan", itemId: asItemId(toolUseId), text: plan };
      return [...this.start(item), ...this.complete(item)];
    }
    const item = startItem(toolUseId, name, input, { cwd: this.context.cwd, mcpServers: this.mcpServers });
    return item === null ? [] : this.start(item);
  }

  markDeclined(toolUseId: string): void {
    this.declined.add(toolUseId);
  }

  /** Applies one classified top-level frame. Sub-agent frames must be filtered by the caller. */
  onFrame(frame: ClaudeFrame): AgentEvent[] {
    switch (frame.kind) {
      case "stream":
        return this.onStream(frame.event);
      case "assistant":
        return this.onAssistant(frame);
      case "user":
        return this.onUser(frame);
      case "compactBoundary": {
        const item: AgentItem = { type: "compaction", itemId: asItemId(frame.uuid ?? `${this.context.turnId}:compact`) };
        return [...this.start(item), ...this.complete(item)];
      }
      default:
        return [];
    }
  }

  private onStream(event: Extract<ClaudeFrame, { kind: "stream" }>["event"]): AgentEvent[] {
    switch (event.type) {
      case "messageStart":
        this.currentMessageId = event.messageId;
        this.streamBlocks.clear();
        return [];
      case "blockStart": {
        if (this.currentMessageId === null || (event.block !== "text" && event.block !== "thinking")) return [];
        const itemId = blockItemId(this.currentMessageId, event.index);
        this.streamBlocks.set(event.index, itemId);
        return this.startBlock(itemId, event.block);
      }
      case "textDelta": {
        const itemId = this.streamBlocks.get(event.index);
        return itemId === undefined ? [] : this.delta(itemId, "agentMessage", event.text);
      }
      case "thinkingDelta": {
        const itemId = this.streamBlocks.get(event.index);
        return itemId === undefined ? [] : this.delta(itemId, "reasoning", event.text);
      }
      default:
        return [];
    }
  }

  private onAssistant(frame: Extract<ClaudeFrame, { kind: "assistant" }>): AgentEvent[] {
    this.lastAssistantError = frame.error;
    const events: AgentEvent[] = [];
    for (const block of frame.blocks) {
      const ordinal = this.snapshotOrdinals.get(frame.messageId) ?? 0;
      this.snapshotOrdinals.set(frame.messageId, ordinal + 1);
      if (block.type === "toolUse") {
        events.push(...this.startTool(block.id, block.name, block.input));
        continue;
      }
      if (block.type !== "text" && block.type !== "thinking") continue;
      const itemId = blockItemId(frame.messageId, ordinal);
      events.push(...this.startBlock(itemId, block.type));
      // Snapshots are authoritative, except that a summarized thinking block
      // may arrive empty after its text was streamed as deltas.
      const streamed = this.slots.get(itemId)?.item;
      const item: AgentItem =
        block.type === "text"
          ? {
              type: "agentMessage",
              itemId,
              text: block.text.length > 0 || streamed?.type !== "agentMessage" ? block.text : streamed.text,
              phase: "commentary",
            }
          : {
              type: "reasoning",
              itemId,
              summary: block.text.length > 0 ? [block.text] : streamed?.type === "reasoning" ? streamed.summary : [],
              content: [],
            };
      events.push(...this.complete(item));
    }
    return events;
  }

  private onUser(frame: Extract<ClaudeFrame, { kind: "user" }>): AgentEvent[] {
    const events: AgentEvent[] = [];
    for (const result of frame.toolResults) {
      const call = this.tools.get(result.toolUseId);
      const slot = this.slots.get(result.toolUseId);
      if (call === undefined || slot === undefined || slot.completed) continue;
      const status = executionStatus(result, frame.nonExecution.get(result.toolUseId), this.declined.has(result.toolUseId));
      const durationMs = Math.max(0, this.context.nowMs() - call.startedAtMs);
      events.push(...this.complete(completeItem(slot.item, call.name, call.input, result, frame.toolUseResult, status, durationMs)));
      const image = status === "completed" ? imageViewFor(result.toolUseId, call.name, call.input) : null;
      if (image !== null) events.push(...this.start(image), ...this.complete(image));
    }
    return events;
  }

  /** Whether any item has been started (a wake turn with no items is dropped). */
  get isEmpty(): boolean {
    return this.order.length === 0;
  }

  /** The in-progress turn with its items so far. */
  snapshot(): AgentTurn {
    return this.turnShape(
      "inProgress",
      this.order.flatMap((id) => {
        const slot = this.slots.get(id);
        return slot === undefined ? [] : [slot.item];
      }),
      null,
      null,
    );
  }

  /**
   * Closes the turn: releases the held agent message (as `final` only for a
   * completed turn), fails every still-open item, emits `usage.updated` when
   * figures are known and finally `turn.completed` with every item.
   */
  finish(outcome: TurnOutcome, usage: { readonly last: TokenUsage; readonly total: TokenUsage; readonly contextWindow: number | null } | null): {
    readonly events: AgentEvent[];
    readonly turn: AgentTurn;
  } {
    const events = this.flushHeld(outcome.status === "completed" ? "final" : "commentary");
    for (const id of this.order) {
      const slot = this.slots.get(id);
      if (slot === undefined || slot.completed) continue;
      slot.item = failOpenItem(slot.item);
      slot.completed = true;
      events.push(this.event("item.completed", slot.item));
    }
    if (usage !== null) {
      events.push({
        type: "usage.updated",
        appThreadId: this.context.appThreadId,
        turnId: this.context.turnId,
        last: usage.last,
        total: usage.total,
        contextWindow: usage.contextWindow,
      });
    }
    const items = this.order.flatMap((id) => {
      const slot = this.slots.get(id);
      return slot === undefined ? [] : [slot.item];
    });
    const turn = this.turnShape(outcome.status, items, seconds(this.context.nowMs()), outcome.status === "failed" ? outcome.error : null);
    events.push({ type: "turn.completed", appThreadId: this.context.appThreadId, turn });
    return { events, turn };
  }
}
