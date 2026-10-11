// Shared guard and query helpers for the paid SDK experiments.
import { query } from "@anthropic-ai/claude-agent-sdk";

export function parseArgs(name, costNote) {
  const args = process.argv.slice(2);
  const value = (flag) => {
    const index = args.indexOf(flag);
    return index >= 0 ? args[index + 1] : undefined;
  };
  process.stderr.write(`${name}: this experiment makes real model calls (${costNote}).\n`);
  if (!args.includes("--confirm-paid")) {
    process.stderr.write("refusing to run without --confirm-paid\n");
    process.exit(2);
  }
  const claude = value("--claude");
  const workspace = value("--workspace");
  if (!claude?.startsWith("/") || !workspace?.startsWith("/")) {
    process.stderr.write("--claude and --workspace must be absolute paths\n");
    process.exit(2);
  }
  return { claude, workspace };
}

export class Input {
  #queue = [];
  #waiter = null;
  push(text, extra = {}) {
    const message = {
      type: "user",
      message: { role: "user", content: text },
      parent_tool_use_id: null,
      ...extra,
    };
    if (this.#waiter) {
      const waiter = this.#waiter;
      this.#waiter = null;
      waiter({ done: false, value: message });
    } else this.#queue.push(message);
  }
  end() {
    this.#waiter?.({ done: true, value: undefined });
  }
  [Symbol.asyncIterator]() {
    return {
      next: () =>
        this.#queue.length > 0
          ? Promise.resolve({ done: false, value: this.#queue.shift() })
          : new Promise((resolve) => (this.#waiter = resolve)),
    };
  }
}

export function open({ claude, workspace }, input, options = {}) {
  return query({
    prompt: input,
    options: {
      pathToClaudeCodeExecutable: claude,
      cwd: workspace,
      env: { ...process.env },
      includePartialMessages: true,
      model: "haiku",
      permissionMode: "bypassPermissions",
      allowDangerouslySkipPermissions: true,
      settingSources: [],
      ...options,
    },
  });
}

export async function drain(handle, until, onMessage = () => {}) {
  for (;;) {
    const next = await handle.next();
    if (next.done) return;
    process.stdout.write(`${JSON.stringify(next.value)}\n`);
    onMessage(next.value);
    if (until(next.value)) return;
  }
}
