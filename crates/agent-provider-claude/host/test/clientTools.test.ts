/**
 * Client tools: the companion's tools reach Claude as one in-process MCP
 * server, calls travel to the companion as `tool.call` over the stdio
 * channel, the calls show as neutral `toolCall` items and in-flight calls end
 * with their turn.
 */

import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { describe, expect, it } from "vitest";
import { asAppThreadId, asTurnId } from "../src/protocol.js";
import type { AgentEvent, ClientToolSpec, ToolCallParams } from "../src/protocol.js";
import type { ClientToolBinding, QueryOpenOptions } from "../src/claude/port.js";
import { clientToolServer } from "../src/claude/sdkClientTools.js";
import { createMemoryLogger } from "../src/log.js";
import { startItem } from "../src/mapping/tools.js";
import { RpcServer, TOOL_CALL_CANCELLED } from "../src/rpc/server.js";
import {
  createThread,
  frames,
  harness,
  prompt,
  scriptedRuntime,
  settle,
  startedTurn,
  THREAD,
} from "./support/scripted.js";

const SPAWN: ClientToolSpec = {
  name: "codewide_spawn_agent",
  description: "Starts another agent on a task.",
  inputSchema: {
    type: "object",
    properties: { prompt: { type: "string" }, name: { type: "string" } },
    required: ["prompt"],
    additionalProperties: false,
  },
};
const LIST: ClientToolSpec = {
  name: "codewide_list_agents",
  description: "Lists the agents of this thread.",
  inputSchema: { type: "object", properties: {} },
};

const SPAWN_TOOL = "mcp__codewide__codewide_spawn_agent";

const toolResult = (toolUseId: string, content: string) => ({
  type: "user",
  message: { role: "user", content: [{ type: "tool_result", tool_use_id: toolUseId, content }] },
  parent_tool_use_id: null,
  uuid: `${toolUseId}-result`,
});

/** Lets a client tool call give up waiting for its item (a few event-loop turns). */
async function settleCalls(): Promise<void> {
  for (let tick = 0; tick < 5; tick += 1) await settle();
}

const itemEvents = (events: readonly AgentEvent[], type: "item.started" | "item.completed") =>
  events.flatMap((event) => (event.type === type ? [event.item] : []));

function bindingOf(options: QueryOpenOptions | undefined): ClientToolBinding {
  const binding = options?.clientTools;
  if (binding === null || binding === undefined) throw new Error("query has no client tools");
  return binding;
}

describe("client tool mapping", () => {
  it("maps a client tool call to a toolCall with its bare name and no namespace", () => {
    expect(
      startItem(
        { id: "toolu_1", name: SPAWN_TOOL, input: { prompt: "review" } },
        { cwd: "/w", mcpServers: [] },
      ),
    ).toEqual({
      arguments: { prompt: "review" },
      durationMs: null,
      itemId: "toolu_1",
      namespace: null,
      output: null,
      status: "inProgress",
      tool: "codewide_spawn_agent",
      type: "toolCall",
    });
    expect(
      startItem(
        { id: "toolu_2", name: "mcp__other__tool", input: {} },
        { cwd: "/w", mcpServers: [] },
      ),
    ).toMatchObject({ type: "mcpToolCall", server: "other", tool: "tool" });
  });
});

describe("SDK client tool server", () => {
  async function connect(binding: ClientToolBinding): Promise<Client> {
    const server = clientToolServer(binding);
    const [serverSide, clientSide] = InMemoryTransport.createLinkedPair();
    await server.instance.connect(serverSide);
    const client = new Client({ name: "test", version: "1" });
    await client.connect(clientSide);
    return client;
  }

  it("publishes each spec's schema and routes calls to the binding", async () => {
    const calls: unknown[] = [];
    const rejected: string[] = [];
    const client = await connect({
      specs: [SPAWN, { name: "broken", description: "x", inputSchema: { type: "string" } }],
      rejected: (tool) => rejected.push(tool),
      invoke: async (invocation) => {
        calls.push({ tool: invocation.tool, arguments: invocation.arguments });
        return {
          success: invocation.arguments["prompt"] !== "fail",
          content: [{ type: "text", text: "done" }],
        };
      },
    });
    const { tools } = await client.listTools();
    expect(tools.map((tool) => tool.name)).toEqual(["codewide_spawn_agent"]);
    expect(tools[0]?.inputSchema).toMatchObject({
      type: "object",
      properties: { prompt: { type: "string" }, name: { type: "string" } },
      required: ["prompt"],
    });
    expect(rejected).toEqual(["broken"]);

    expect(
      await client.callTool({ name: "codewide_spawn_agent", arguments: { prompt: "review" } }),
    ).toEqual({ content: [{ type: "text", text: "done" }], isError: false });
    expect(
      await client.callTool({ name: "codewide_spawn_agent", arguments: { prompt: "fail" } }),
    ).toEqual({ content: [{ type: "text", text: "done" }], isError: true });
    // The SDK rejects arguments that do not match the schema before the handler runs.
    expect(await client.callTool({ name: "codewide_spawn_agent", arguments: {} })).toMatchObject({
      isError: true,
    });
    expect(calls).toEqual([
      { tool: "codewide_spawn_agent", arguments: { prompt: "review" } },
      { tool: "codewide_spawn_agent", arguments: { prompt: "fail" } },
    ]);
  });
});

describe("tool.call over the stdio channel", () => {
  function rpcServer() {
    const lines: Record<string, unknown>[] = [];
    const { service, queries } = harness();
    const rpc = new RpcServer({
      service,
      runtime: scriptedRuntime().runtime,
      logger: createMemoryLogger(),
      write: (line) => lines.push(JSON.parse(line)),
      version: "0.1.0",
    });
    return { rpc, lines, queries };
  }

  const initialize = JSON.stringify({
    id: 1,
    method: "initialize",
    params: { protocol: "codewide-agent", protocolVersion: 1, client: { name: "t", version: "0" } },
  });

  const params: ToolCallParams = {
    appThreadId: asAppThreadId(THREAD),
    turnId: asTurnId("turn-1"),
    callId: "toolu_1",
    tool: "codewide_list_agents",
    arguments: {},
  };

  it("sends a provider request with a host-minted id and resolves with the answer", async () => {
    const { rpc, lines } = rpcServer();
    const first = rpc.callTool(params, new AbortController().signal);
    const second = rpc.callTool({ ...params, callId: "toolu_2" }, new AbortController().signal);
    expect(lines).toEqual([
      { id: "claude-host:1", method: "tool.call", params },
      { id: "claude-host:2", method: "tool.call", params: { ...params, callId: "toolu_2" } },
    ]);
    await rpc.handleLine(
      JSON.stringify({ id: "claude-host:2", error: { code: -32603, message: "agent not found" } }),
    );
    await rpc.handleLine(
      JSON.stringify({
        id: "claude-host:1",
        result: { success: true, content: [{ type: "text", text: '{"agents":[]}' }] },
      }),
    );
    await expect(first).resolves.toEqual({
      success: true,
      content: [{ type: "text", text: '{"agents":[]}' }],
    });
    await expect(second).resolves.toEqual({
      success: false,
      content: [{ type: "text", text: "agent not found" }],
    });
    // Answers are not requests: the server writes nothing back.
    expect(lines).toHaveLength(2);
  });

  it("treats a malformed result as a failure and ignores a late answer after abort", async () => {
    const { rpc, lines } = rpcServer();
    const malformed = rpc.callTool(params, new AbortController().signal);
    await rpc.handleLine(JSON.stringify({ id: "claude-host:1", result: { success: "yes" } }));
    await expect(malformed).resolves.toMatchObject({ success: false });

    const abort = new AbortController();
    const aborted = rpc.callTool(params, abort.signal);
    abort.abort();
    await expect(aborted).resolves.toEqual({
      success: false,
      content: [{ type: "text", text: TOOL_CALL_CANCELLED }],
    });
    await rpc.handleLine(
      JSON.stringify({ id: "claude-host:2", result: { success: true, content: [] } }),
    );
    expect(lines.filter((line) => "error" in line)).toEqual([]);
  });

  it("registers the clientTools of thread.create for the thread's turns", async () => {
    const { rpc, lines, queries } = rpcServer();
    await rpc.handleLine(initialize);
    await rpc.handleLine(
      JSON.stringify({
        id: 2,
        method: "thread.create",
        params: {
          appThreadId: THREAD,
          cwd: "/w",
          settings: {
            model: "m",
            effort: null,
            permissionProfile: ":workspace",
            serviceTier: null,
          },
          clientTools: [LIST],
        },
      }),
    );
    await rpc.handleLine(
      JSON.stringify({
        id: 3,
        method: "turn.start",
        params: { appThreadId: THREAD, clientMessageId: null, input: [] },
      }),
    );
    expect(lines.at(-1)).toMatchObject({ id: 3, result: { type: "started" } });
    expect(bindingOf(queries[0]?.options).specs).toEqual([LIST]);
  });

  it("validates clientTools on turn.start", async () => {
    const { rpc, lines } = rpcServer();
    await rpc.handleLine(initialize);
    expect(lines.at(-1)).toMatchObject({
      id: 1,
      result: { capabilities: { "orchestration.tools": true, "threads.crossProviderFork": true } },
    });
    await rpc.handleLine(
      JSON.stringify({
        id: 2,
        method: "turn.start",
        params: {
          appThreadId: THREAD,
          clientMessageId: null,
          input: [],
          clientTools: [{ name: "bad name", description: "", inputSchema: {} }],
        },
      }),
    );
    expect(lines.at(-1)).toMatchObject({
      id: 2,
      error: { code: -32602, message: expect.stringContaining("params.clientTools[0].name") },
    });
  });
});

describe("client tools in a session", () => {
  it("registers the tools, allows them without a prompt under :read-only and calls the companion", async () => {
    const { service, queries, events, toolCalls } = harness();
    createThread(service, THREAD, ":read-only");
    const turnId = startedTurn(await service.startTurn(THREAD, prompt("delegate"), [SPAWN]));
    const query = queries[0];
    expect(bindingOf(query?.options).specs).toEqual([SPAWN]);

    query?.push(frames.init);
    query?.push(frames.toolUse("m1", "toolu_1", SPAWN_TOOL, { prompt: "review", name: "rev" }));
    await settle();
    const decision = await query?.options.canUseTool({
      toolName: SPAWN_TOOL,
      input: { prompt: "review", name: "rev" },
      toolUseId: "toolu_1",
      decisionReason: null,
      signal: new AbortController().signal,
    });
    expect(decision).toMatchObject({ behavior: "allow", toolUseID: "toolu_1" });
    // Other MCP tools stay refused under :read-only.
    await expect(
      query?.options.canUseTool({
        toolName: "mcp__other__write",
        input: {},
        toolUseId: "toolu_x",
        decisionReason: null,
        signal: new AbortController().signal,
      }),
    ).resolves.toMatchObject({ behavior: "deny" });
    expect(events.some((event) => event.type === "request.opened")).toBe(false);

    const result = bindingOf(query?.options).invoke({
      tool: "codewide_spawn_agent",
      arguments: { prompt: "review", name: "rev" },
      signal: null,
    });
    await settle();
    expect(toolCalls.map((call) => call.params)).toEqual([
      {
        appThreadId: THREAD,
        turnId,
        callId: "toolu_1",
        tool: "codewide_spawn_agent",
        arguments: { prompt: "review", name: "rev" },
      },
    ]);
    const answer = '{"agentThreadId":"child","provider":"codex","model":"m","status":"running"}';
    toolCalls[0]?.answer({ success: true, content: [{ type: "text", text: answer }] });
    await expect(result).resolves.toEqual({
      success: true,
      content: [{ type: "text", text: answer }],
    });

    query?.push(toolResult("toolu_1", answer));
    query?.push(frames.result());
    await settle();
    expect(itemEvents(events, "item.started")).toContainEqual(
      expect.objectContaining({ type: "toolCall", tool: "codewide_spawn_agent", namespace: null }),
    );
    expect(itemEvents(events, "item.completed")).toContainEqual(
      expect.objectContaining({
        itemId: "toolu_1",
        type: "toolCall",
        tool: "codewide_spawn_agent",
        status: "completed",
        output: answer,
      }),
    );
  });

  it("uses a fresh call id when the call has no visible item yet", async () => {
    const { service, queries, toolCalls } = harness();
    createThread(service);
    startedTurn(await service.startTurn(THREAD, prompt("go"), [LIST]));
    void bindingOf(queries[0]?.options).invoke({
      tool: "codewide_list_agents",
      arguments: {},
      signal: null,
    });
    await settleCalls();
    expect(toolCalls).toHaveLength(1);
    expect(toolCalls[0]?.params.callId).toMatch(/^[0-9a-f]{8}-/u);
  });

  it("cancels an in-flight call when the turn is interrupted or Claude aborts it", async () => {
    const { service, queries, toolCalls } = harness({ interruptTimeoutMs: 20 });
    createThread(service);
    const turnId = startedTurn(await service.startTurn(THREAD, prompt("go"), [LIST]));
    const binding = bindingOf(queries[0]?.options);
    const claudeAbort = new AbortController();
    const aborted = binding.invoke({
      tool: "codewide_list_agents",
      arguments: {},
      signal: claudeAbort.signal,
    });
    const interrupted = binding.invoke({
      tool: "codewide_list_agents",
      arguments: {},
      signal: null,
    });
    await settleCalls();
    expect(toolCalls).toHaveLength(2);
    claudeAbort.abort();
    expect(toolCalls[0]?.signal.aborted).toBe(true);
    expect(toolCalls[1]?.signal.aborted).toBe(false);
    await service.interrupt(THREAD, turnId);
    expect(toolCalls[1]?.signal.aborted).toBe(true);
    await expect(aborted).resolves.toMatchObject({ success: false });
    await expect(interrupted).resolves.toMatchObject({ success: false });
  });

  it("reopens an idle query only when the tool set changes", async () => {
    const { service, queries } = harness();
    createThread(service);
    startedTurn(await service.startTurn(THREAD, prompt("one"), [LIST]));
    queries[0]?.push(frames.init);
    queries[0]?.push(frames.result());
    await settle();
    startedTurn(await service.startTurn(THREAD, prompt("two"), [LIST]));
    queries[0]?.push(frames.result());
    await settle();
    expect(queries).toHaveLength(1);
    // Absent clientTools keep the set.
    startedTurn(await service.startTurn(THREAD, prompt("three")));
    queries[0]?.push(frames.result());
    await settle();
    expect(queries).toHaveLength(1);

    startedTurn(await service.startTurn(THREAD, prompt("four"), [LIST, SPAWN]));
    expect(queries[0]?.closed).toBe(true);
    expect(queries).toHaveLength(2);
    expect(queries[1]?.options.identity).toEqual({ type: "resume", sessionId: THREAD });
    expect(bindingOf(queries[1]?.options).specs).toEqual([LIST, SPAWN]);
    queries[1]?.push(frames.result());
    await settle();

    startedTurn(await service.startTurn(THREAD, prompt("five"), []));
    expect(queries[2]?.options.clientTools).toBeNull();
  });
});
