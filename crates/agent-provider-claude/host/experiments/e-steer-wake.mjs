// E-STEER-WAKE: a steer while a background-task wake turn runs, and while /compact runs.
import { randomUUID } from "node:crypto";
import { drain, Input, open, parseArgs } from "./common.mjs";

const config = parseArgs("E-STEER-WAKE", "~$0.03 with haiku");
const input = new Input();
const handle = open(config, input);
input.push(
  "Call the Bash tool with run_in_background true and the command `sleep 8 && echo BG_DONE`, then reply STARTED.",
  { uuid: randomUUID() },
);
await drain(handle, (message) => message.type === "result");
let steered = false;
await drain(
  handle,
  (message) => message.type === "result" && steered,
  (message) => {
    if (!steered && message.type === "system" && message.subtype === "task_notification") {
      steered = true;
      input.push("While you handle that, also reply with exactly: WAKE_STEER", {
        uuid: randomUUID(),
        priority: "now",
      });
    }
  },
);
input.push("/compact", { uuid: randomUUID() });
input.push("Reply with exactly: AFTER_COMPACT", { uuid: randomUUID(), priority: "now" });
await drain(
  handle,
  (message) =>
    message.type === "result" &&
    typeof message.result === "string" &&
    message.result.includes("AFTER_COMPACT"),
);
input.end();
handle.close();
