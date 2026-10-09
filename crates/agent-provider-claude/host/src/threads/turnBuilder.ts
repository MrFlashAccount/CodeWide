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
  Provenance,
  TokenUsage,
  TurnError,
  TurnId,
  TurnOrigin,
  UserContent,
} from "../protocol.js";
import { asItemId, asProviderThreadRef, PROVIDER_ID } from "../protocol.js";
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
import { unreachable } from "../support/unreachable.js";
import type { TurnOutcome } from "../mapping/result.js";

interface ItemSlot {
  completed: boolean;
  item: AgentItem;
}

interface ToolCall {
  readonly input: JsonRecord;
  readonly name: string;
  readonly startedAtMs: number;
}

export interface TurnBuilderContext {
  readonly appThreadId: AppThreadId;
  readonly cwd: string;
  readonly nowMs: () => number;
  readonly origin: TurnOrigin;
  readonly turnId: TurnId;
}

const MS_PER_SECOND = 1000;
const seconds = (ms: number): number => Math.floor(ms / MS_PER_SECOND);

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

  private readonly context: TurnBuilderContext;
  /** The native thread every turn and item of this builder came from: the Claude thread itself (phase 1). */
  private readonly provenance: Provenance;

  public constructor(context: TurnBuilderContext) {
    this.context = context;
    this.startedAt = seconds(context.nowMs());
    this.provenance = {
      nativeThreadId: asProviderThreadRef(context.appThreadId),
      provider: PROVIDER_ID,
    };
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

  private turnShape(
    status: AgentTurn["status"],
    end: {
      readonly completedAt: number | null;
      readonly error: TurnError | null;
      readonly items: readonly AgentItem[];
    },
  ): AgentTurn {
    return {
      completedAt: end.completedAt,
      error: end.error,
      items: end.items,
      origin: this.context.origin,
      provenance: this.provenance,
      startedAt: this.startedAt,
      status,
      turnId: this.context.turnId,
    };
  }

  /** `turn.started` plus, for a user turn, its first `userMessage`. */
  begin(
    userMessage: {
      readonly clientMessageId: ClientMessageId | null;
      readonly content: readonly UserContent[];
    } | null,
  ): AgentEvent[] {
    const events: AgentEvent[] = [
      {
        appThreadId: this.context.appThreadId,
        turn: this.turnShape("inProgress", { completedAt: null, error: null, items: [] }),
        type: "turn.started",
      },
    ];
    if (userMessage !== null) {
      events.push(...this.addUserMessage(userMessage.clientMessageId, userMessage.content));
    }
    return events;
  }

  /** A user message inside this turn (the first one, or an explicit steer). */
  addUserMessage(
    clientMessageId: ClientMessageId | null,
    content: readonly UserContent[],
  ): AgentEvent[] {
    const itemId = asItemId(`${this.context.turnId}:user:${String(this.userMessageCount)}`);
    this.userMessageCount += 1;
    const item: AgentItem = { clientMessageId, content, itemId, type: "userMessage" };
    return [...this.start(item), ...this.complete(item)];
  }

  private event(type: "item.started" | "item.completed", item: AgentItem): AgentEvent {
    return { appThreadId: this.context.appThreadId, item, turnId: this.context.turnId, type };
  }

  private flushHeld(phase: "commentary" | "final"): AgentEvent[] {
    const held = this.heldAgentMessage;
    if (held === null) {
      return [];
    }
    this.heldAgentMessage = null;
    const slot = this.slots.get(held);
    if (slot === undefined || slot.item.type !== "agentMessage") {
      return [];
    }
    slot.item = { ...slot.item, phase };
    slot.completed = true;
    return [this.event("item.completed", slot.item)];
  }

  /** The item with this turn's origin. */
  private stamped(item: AgentItem): AgentItem {
    return { ...item, provenance: this.provenance };
  }

  private start(body: AgentItem): AgentEvent[] {
    const item = this.stamped(body);
    if (this.slots.has(item.itemId)) {
      return [];
    }
    const events = this.flushHeld("commentary");
    this.slots.set(item.itemId, { completed: false, item });
    this.order.push(item.itemId);
    events.push(this.event("item.started", item));
    return events;
  }

  private complete(body: AgentItem): AgentEvent[] {
    const item = this.stamped(body);
    const slot = this.slots.get(item.itemId);
    if (slot === undefined || slot.completed) {
      return [];
    }
    slot.item = item;
    if (item.type === "agentMessage") {
      const events = this.heldAgentMessage === item.itemId ? [] : this.flushHeld("commentary");
      this.heldAgentMessage = item.itemId;
      return events;
    }
    slot.completed = true;
    return [this.event("item.completed", item)];
  }

  private deltaEvent(
    itemId: ItemId,
    delta: Extract<AgentEvent, { readonly type: "item.delta" }>["delta"],
  ): AgentEvent {
    return {
      appThreadId: this.context.appThreadId,
      delta,
      itemId,
      turnId: this.context.turnId,
      type: "item.delta",
    };
  }

  /** The open, not held item `itemId`, when it accepts deltas of `type`. */
  private openSlot(itemId: ItemId, type: "agentMessage" | "reasoning"): ItemSlot | null {
    const slot = this.slots.get(itemId);
    if (slot === undefined || slot.completed || this.heldAgentMessage === itemId) {
      return null;
    }
    return slot.item.type === type ? slot : null;
  }

  private textDelta(itemId: ItemId, text: string): AgentEvent[] {
    const slot = this.openSlot(itemId, "agentMessage");
    if (slot?.item.type !== "agentMessage" || text.length === 0) {
      return [];
    }
    slot.item = { ...slot.item, text: slot.item.text + text };
    return [this.deltaEvent(itemId, { kind: "text", text })];
  }

  private reasoningDelta(itemId: ItemId, text: string): AgentEvent[] {
    const slot = this.openSlot(itemId, "reasoning");
    if (slot?.item.type !== "reasoning" || text.length === 0) {
      return [];
    }
    slot.item = { ...slot.item, summary: [(slot.item.summary[0] ?? "") + text] };
    return [this.deltaEvent(itemId, { kind: "reasoning", summaryIndex: 0, text })];
  }

  private startBlock(itemId: ItemId, kind: "text" | "thinking"): AgentEvent[] {
    const item: AgentItem =
      kind === "text"
        ? { itemId, phase: "commentary", text: "", type: "agentMessage" }
        : { content: [], itemId, summary: [], type: "reasoning" };
    return this.start(item);
  }

  /** Starts the item of a tool call if it has not started yet (from a snapshot or `canUseTool`). */
  startTool(toolUseId: string, name: string, input: JsonRecord): AgentEvent[] {
    if (this.tools.has(toolUseId)) {
      return [];
    }
    this.tools.set(toolUseId, { input, name, startedAtMs: this.context.nowMs() });
    const disposition = toolDisposition(name);
    if (disposition.type === "plan") {
      return [
        {
          appThreadId: this.context.appThreadId,
          explanation: null,
          plan: todoPlan(input),
          turnId: this.context.turnId,
          type: "plan.updated",
        },
      ];
    }
    if (disposition.type === "exitPlan") {
      const plan = typeof input["plan"] === "string" ? input["plan"] : "";
      const item: AgentItem = { itemId: asItemId(toolUseId), text: plan, type: "plan" };
      return [...this.start(item), ...this.complete(item)];
    }
    const item = startItem(
      { id: toolUseId, input, name },
      { cwd: this.context.cwd, mcpServers: this.mcpServers },
    );
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
        const item: AgentItem = {
          itemId: asItemId(frame.uuid ?? `${this.context.turnId}:compact`),
          type: "compaction",
        };
        return [...this.start(item), ...this.complete(item)];
      }
      case "init":
      case "backgroundTasks":
      case "rateLimit":
      case "result":
      case "other":
        return [];
      default:
        return unreachable(frame);
    }
  }

  private onStream(event: Extract<ClaudeFrame, { kind: "stream" }>["event"]): AgentEvent[] {
    switch (event.type) {
      case "messageStart":
        this.currentMessageId = event.messageId;
        this.streamBlocks.clear();
        return [];
      case "blockStart": {
        if (
          this.currentMessageId === null ||
          (event.block !== "text" && event.block !== "thinking")
        ) {
          return [];
        }
        const itemId = blockItemId(this.currentMessageId, event.index);
        this.streamBlocks.set(event.index, itemId);
        return this.startBlock(itemId, event.block);
      }
      case "textDelta": {
        const itemId = this.streamBlocks.get(event.index);
        return itemId === undefined ? [] : this.textDelta(itemId, event.text);
      }
      case "thinkingDelta": {
        const itemId = this.streamBlocks.get(event.index);
        return itemId === undefined ? [] : this.reasoningDelta(itemId, event.text);
      }
      case "blockStop":
      case "other":
        return [];
      default:
        return unreachable(event);
    }
  }

  /**
   * The completed item of a text or thinking snapshot block. Snapshots are
   * authoritative, except that a summarized thinking block may arrive empty
   * after its text was streamed as deltas.
   */
  private snapshotItem(
    itemId: ItemId,
    block: { readonly text: string; readonly type: "text" | "thinking" },
  ): AgentItem {
    const streamed = block.text.length === 0 ? this.slots.get(itemId)?.item : undefined;
    if (block.type === "text") {
      const text = streamed?.type === "agentMessage" ? streamed.text : block.text;
      return { itemId, phase: "commentary", text, type: "agentMessage" };
    }
    const summary =
      streamed?.type === "reasoning"
        ? streamed.summary
        : [block.text].filter((text) => text.length > 0);
    return { content: [], itemId, summary, type: "reasoning" };
  }

  private onAssistant(frame: Extract<ClaudeFrame, { kind: "assistant" }>): AgentEvent[] {
    this.lastAssistantError = frame.error;
    const events: AgentEvent[] = [];
    for (const block of frame.blocks) {
      const ordinal = this.snapshotOrdinals.get(frame.messageId) ?? 0;
      this.snapshotOrdinals.set(frame.messageId, ordinal + 1);
      if (block.type === "toolUse") {
        events.push(...this.startTool(block.id, block.name, block.input));
      } else if (block.type !== "other") {
        const itemId = blockItemId(frame.messageId, ordinal);
        events.push(
          ...this.startBlock(itemId, block.type),
          ...this.complete(this.snapshotItem(itemId, block)),
        );
      }
    }
    return events;
  }

  private onUser(frame: Extract<ClaudeFrame, { kind: "user" }>): AgentEvent[] {
    const events: AgentEvent[] = [];
    for (const result of frame.toolResults) {
      const call = this.tools.get(result.toolUseId);
      const slot = this.slots.get(result.toolUseId);
      if (call === undefined || slot === undefined || slot.completed) {
        continue;
      }
      const status = executionStatus(
        result,
        frame.nonExecution.get(result.toolUseId),
        this.declined.has(result.toolUseId),
      );
      const durationMs = Math.max(0, this.context.nowMs() - call.startedAtMs);
      const completed = completeItem(
        slot.item,
        { id: result.toolUseId, input: call.input, name: call.name },
        { durationMs, result, status, toolUseResult: frame.toolUseResult },
      );
      events.push(...this.complete(completed));
      const image =
        status === "completed" ? imageViewFor(result.toolUseId, call.name, call.input) : null;
      if (image !== null) {
        events.push(...this.start(image), ...this.complete(image));
      }
    }
    return events;
  }

  /** Whether any item has been started (a wake turn with no items is dropped). */
  get isEmpty(): boolean {
    return this.order.length === 0;
  }

  private items(): readonly AgentItem[] {
    return this.order.flatMap((id) => {
      const slot = this.slots.get(id);
      return slot === undefined ? [] : [slot.item];
    });
  }

  /** The in-progress turn with its items so far. */
  snapshot(): AgentTurn {
    return this.turnShape("inProgress", { completedAt: null, error: null, items: this.items() });
  }

  /**
   * Closes the turn: releases the held agent message (as `final` only for a
   * completed turn), fails every still-open item, emits `usage.updated` when
   * figures are known and finally `turn.completed` with every item.
   */
  finish(
    outcome: TurnOutcome,
    usage: {
      readonly contextWindow: number | null;
      readonly last: TokenUsage;
      readonly total: TokenUsage;
    } | null,
  ): {
    readonly events: AgentEvent[];
    readonly turn: AgentTurn;
  } {
    const events = this.flushHeld(outcome.status === "completed" ? "final" : "commentary");
    for (const id of this.order) {
      const slot = this.slots.get(id);
      if (slot === undefined || slot.completed) {
        continue;
      }
      slot.item = failOpenItem(slot.item);
      slot.completed = true;
      events.push(this.event("item.completed", slot.item));
    }
    if (usage !== null) {
      events.push({
        appThreadId: this.context.appThreadId,
        contextWindow: usage.contextWindow,
        last: usage.last,
        total: usage.total,
        turnId: this.context.turnId,
        type: "usage.updated",
      });
    }
    const turn = this.turnShape(outcome.status, {
      completedAt: seconds(this.context.nowMs()),
      error: outcome.status === "failed" ? outcome.error : null,
      items: this.items(),
    });
    events.push({ appThreadId: this.context.appThreadId, turn, type: "turn.completed" });
    return { events, turn };
  }
}
