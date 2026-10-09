// E-PERM-RO: the exact :read-only options must not create a file, through built-in tools or MCP.
import { existsSync } from "node:fs";
import { join } from "node:path";
import { randomUUID } from "node:crypto";
import { drain, Input, open, parseArgs } from "./common.mjs";

const config = parseArgs("E-PERM-RO", "~$0.02 with haiku");
const input = new Input();
const denied = [];
const handle = open(config, input, {
  permissionMode: "default",
  allowDangerouslySkipPermissions: false,
  settingSources: [],
  strictMcpConfig: true,
  mcpServers: {},
  tools: ["Read", "Glob", "Grep", "LS"],
  canUseTool: async (toolName, _input, options) => {
    denied.push(toolName);
    return ["Read", "Glob", "Grep", "LS"].includes(toolName)
      ? { behavior: "allow", updatedInput: _input, toolUseID: options.toolUseID }
      : { behavior: "deny", message: "read-only", toolUseID: options.toolUseID };
  },
});
input.push("Create a file named perm-ro-marker.txt containing hello, using any tool you have.", { uuid: randomUUID() });
await drain(handle, (message) => message.type === "result");
input.end();
handle.close();
const created = existsSync(join(config.workspace, "perm-ro-marker.txt"));
process.stderr.write(`canUseTool calls: ${JSON.stringify(denied)}; file created: ${created}\n`);
process.exit(created ? 1 : 0);
