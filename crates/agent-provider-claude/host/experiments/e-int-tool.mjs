// E-INT-TOOL: interrupt during a running tool, then send another prompt without close().
import { randomUUID } from "node:crypto";
import { drain, Input, open, parseArgs } from "./common.mjs";

const config = parseArgs("E-INT-TOOL", "~$0.01 with haiku");
const input = new Input();
const handle = open(config, input);
input.push("Run the shell command `sleep 30 && echo done`, then say finished.", {
  uuid: randomUUID(),
});
await drain(
  handle,
  (message) =>
    message.type === "assistant" &&
    message.message.content.some((block) => block.type === "tool_use"),
);
await new Promise((resolve) => setTimeout(resolve, 1500));
await handle.interrupt();
await drain(handle, (message) => message.type === "result");
input.push("Reply with exactly: ALIVE", { uuid: randomUUID() });
await drain(handle, (message) => message.type === "result");
input.end();
handle.close();
