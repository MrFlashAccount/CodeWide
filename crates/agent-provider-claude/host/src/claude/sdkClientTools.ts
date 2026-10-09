/**
 * The companion's client tools as an in-process Agent SDK MCP server.
 *
 * Each `ClientToolSpec` becomes one SDK `tool()` whose input schema is the
 * spec's JSON Schema converted to Zod (`z.fromJSONSchema`); the SDK checks
 * every call against it before the handler runs. The handler forwards the
 * call to the binding and maps its result to an MCP `CallToolResult`. A spec
 * whose schema is not a convertible object schema is reported and left out,
 * so one bad spec never disables the others or the session.
 */

import {
  createSdkMcpServer,
  tool,
  type McpSdkServerConfigWithInstance,
  type SdkMcpToolDefinition,
} from "@anthropic-ai/claude-agent-sdk";
import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import { z } from "zod";
import type { ToolCallResult } from "../protocol.js";
import { CLIENT_TOOL_SERVER } from "../mapping/clientTools.js";
import { isRecord } from "../mapping/frames.js";
import type { ClientToolBinding } from "./port.js";

type ObjectShape = z.ZodObject["shape"];

type ShapeResult =
  | { readonly error: Error; readonly status: "error" }
  | { readonly shape: ObjectShape; readonly status: "ok" };

const toError = (error: unknown): Error =>
  error instanceof Error ? error : new Error(String(error));

/** Zod 4 names every schema's kind in `type`; `"object"` is exactly `ZodObject`. */
const isObjectSchema = (schema: z.ZodType): schema is z.ZodObject => schema.type === "object";

/** The Zod object shape of a JSON Schema object schema. */
function objectShape(schema: unknown): ShapeResult {
  if (!isRecord(schema)) {
    return { error: new Error("input schema is not an object"), status: "error" };
  }
  try {
    // `fromJSONSchema` throws on an unsupported or malformed schema.
    const converted = z.fromJSONSchema(schema);
    return isObjectSchema(converted)
      ? { shape: converted.shape, status: "ok" }
      : { error: new Error("input schema is not an object schema"), status: "error" };
  } catch (error) {
    return { error: toError(error), status: "error" };
  }
}

/** Brand check through `Symbol.toStringTag`, which every `AbortSignal` carries. */
const isAbortSignal = (value: unknown): value is AbortSignal =>
  Object.prototype.toString.call(value) === "[object AbortSignal]";

/** The abort signal the MCP server passes in the handler's `extra`, when any. */
function signalOf(extra: unknown): AbortSignal | null {
  if (typeof extra !== "object" || extra === null) {
    return null;
  }
  const signal: unknown = Reflect.get(extra, "signal");
  return isAbortSignal(signal) ? signal : null;
}

const callToolResult = (result: ToolCallResult): CallToolResult => ({
  content: result.content.map((block) => ({ text: block.text, type: "text" })),
  isError: !result.success,
});

/** The SDK MCP server that carries `binding`'s client tools. */
export function clientToolServer(binding: ClientToolBinding): McpSdkServerConfigWithInstance {
  const tools = binding.specs.flatMap((spec): SdkMcpToolDefinition<ObjectShape>[] => {
    const shape = objectShape(spec.inputSchema);
    if (shape.status === "error") {
      binding.rejected(spec.name, shape.error);
      return [];
    }
    return [
      tool(spec.name, spec.description, shape.shape, async (args, extra) =>
        callToolResult(
          await binding.invoke({ arguments: args, signal: signalOf(extra), tool: spec.name }),
        ),
      ),
    ];
  });
  return createSdkMcpServer({ alwaysLoad: true, name: CLIENT_TOOL_SERVER, tools });
}
