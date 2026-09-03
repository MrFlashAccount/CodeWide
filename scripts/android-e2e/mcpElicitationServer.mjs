#!/usr/bin/env node

import readline from "node:readline";

const TOOL_NAME = "request_confirmation";
const ELICITATION_ID = "android-e2e-elicitation";
const ELICITATION_MESSAGE = "Confirm the Android MCP parity request";

const pendingToolCalls = new Map();

const input = readline.createInterface({ input: process.stdin, terminal: false });
input.on("line", (line) => {
  if (line.trim() === "") return;
  let message;
  try {
    message = JSON.parse(line);
  } catch {
    process.exitCode = 1;
    input.close();
    return;
  }
  handleMessage(message);
});

function handleMessage(message) {
  if (message === null || typeof message !== "object") return;
  if (message.method === "initialize" && hasRequestId(message)) {
    respond(message.id, {
      capabilities: { tools: {} },
      protocolVersion: protocolVersion(message),
      serverInfo: { name: "android-parity", version: "1.0.0" },
    });
    return;
  }
  if (message.method === "ping" && hasRequestId(message)) {
    respond(message.id, {});
    return;
  }
  if (message.method === "tools/list" && hasRequestId(message)) {
    respond(message.id, {
      tools: [
        {
          description: "Requests one real typed confirmation from the Android user.",
          inputSchema: { additionalProperties: false, properties: {}, type: "object" },
          name: TOOL_NAME,
        },
      ],
    });
    return;
  }
  if (message.method === "tools/call" && hasRequestId(message)) {
    if (message.params?.name !== TOOL_NAME) {
      fail(message.id, -32602, `Unknown tool ${String(message.params?.name)}`);
      return;
    }
    const elicitationRequestId = `${ELICITATION_ID}-${String(message.id)}`;
    pendingToolCalls.set(elicitationRequestId, message.id);
    send({
      id: elicitationRequestId,
      jsonrpc: "2.0",
      method: "elicitation/create",
      params: {
        message: ELICITATION_MESSAGE,
        requestedSchema: {
          additionalProperties: false,
          properties: {
            confirmed: {
              description: "Allow the bounded Android parity fixture to continue",
              title: "Confirmed",
              type: "boolean",
            },
          },
          required: ["confirmed"],
          type: "object",
        },
      },
    });
    return;
  }
  if (hasResponseId(message)) {
    const toolCallId = pendingToolCalls.get(String(message.id));
    if (toolCallId === undefined) return;
    pendingToolCalls.delete(String(message.id));
    const action = message.result?.action;
    respond(toolCallId, {
      content: [
        {
          text:
            action === "accept"
              ? "Android MCP elicitation accepted"
              : "Android MCP elicitation declined",
          type: "text",
        },
      ],
      isError: false,
    });
  }
}

function protocolVersion(message) {
  const requested = message.params?.protocolVersion;
  return typeof requested === "string" ? requested : "2025-06-18";
}

function hasRequestId(message) {
  return typeof message.id === "number" || typeof message.id === "string";
}

function hasResponseId(message) {
  return hasRequestId(message) && ("result" in message || "error" in message);
}

function respond(id, result) {
  send({ id, jsonrpc: "2.0", result });
}

function fail(id, code, message) {
  send({ error: { code, message }, id, jsonrpc: "2.0" });
}

function send(message) {
  process.stdout.write(`${JSON.stringify(message)}\n`);
}
