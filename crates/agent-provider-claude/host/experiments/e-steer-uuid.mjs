// E-STEER-UUID: steer with a fresh uuid during text streaming and during a tool.
import { randomUUID } from "node:crypto";
import { drain, Input, open, parseArgs } from "./common.mjs";

const config = parseArgs("E-STEER-UUID", "~$0.02 with haiku");
for (const phase of ["text", "tool"]) {
  const input = new Input();
  const handle = open(config, input);
  input.push(
    phase === "text"
      ? "Count slowly from 1 to 200, one number per line."
      : "Run the shell command `sleep 20 && echo done`, then say finished.",
    { uuid: randomUUID() },
  );
  let steered = false;
  await drain(
    handle,
    (message) =>
      message.type === "result" &&
      steered &&
      message.terminal_reason !== "aborted_streaming" &&
      message.terminal_reason !== "aborted_tools",
    (message) => {
      const trigger =
        phase === "text"
          ? message.type === "stream_event"
          : message.type === "assistant" &&
            message.message.content.some((block) => block.type === "tool_use");
      if (!steered && trigger) {
        steered = true;
        input.push("Stop that. Reply with exactly: STEERED", {
          uuid: randomUUID(),
          priority: "now",
        });
      }
    },
  );
  input.end();
  handle.close();
}
