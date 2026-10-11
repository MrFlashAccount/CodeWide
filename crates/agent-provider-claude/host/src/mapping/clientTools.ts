/**
 * Naming of the companion's client tools inside Claude.
 *
 * The host registers the client tools of a thread as one in-process MCP
 * server named `CLIENT_TOOL_SERVER`, so Claude calls them as
 * `mcp__codewide__<tool>`. Their items are neutral `toolCall`s with the bare
 * tool name and no namespace, the same shape on every provider. Pure.
 */

/** Name of the in-process MCP server that carries the client tools. */
export const CLIENT_TOOL_SERVER = "codewide";

const QUALIFIED_PREFIX = `mcp__${CLIENT_TOOL_SERVER}__`;

/** The name Claude calls a client tool by. */
export const qualifiedClientToolName = (tool: string): string => `${QUALIFIED_PREFIX}${tool}`;

/** The bare client tool name of a Claude tool name, or `null` for other tools. */
export function clientToolOf(toolName: string): string | null {
  return toolName.startsWith(QUALIFIED_PREFIX) && toolName.length > QUALIFIED_PREFIX.length
    ? toolName.slice(QUALIFIED_PREFIX.length)
    : null;
}
