import { afterEach, describe, expect, it } from "vitest";

import { AppServerRpcError, StdioAppServerClient } from "../src/index.js";

const fakeServer = String.raw`
const readline = require("node:readline");
const rl = readline.createInterface({ input: process.stdin });
rl.on("line", (line) => {
  const frame = JSON.parse(line);
  if (frame.method === "explode") {
    process.stdout.write(JSON.stringify({ id: frame.id, error: { code: -32000, message: "boom" } }) + "\n");
  } else if (Object.hasOwn(frame, "id")) {
    process.stdout.write(JSON.stringify({ id: frame.id, result: { echo: frame.params ?? null } }) + "\n");
  } else {
    process.stdout.write(JSON.stringify({ method: "seen", params: frame }) + "\n");
  }
});
`;

describe("StdioAppServerClient", () => {
  let client: StdioAppServerClient | undefined;

  afterEach(async () => {
    await client?.close();
  });

  it("correlates responses and emits notifications", async () => {
    client = new StdioAppServerClient({
      command: process.execPath,
      args: ["-e", fakeServer],
    });
    client.start();
    const result = await client.request<{ echo: { value: number } }>("echo", { value: 42 });
    expect(result).toEqual({ echo: { value: 42 } });

    const notification = new Promise((resolve) => {
      client?.subscribe(resolve);
    });
    await client.notify("client-ready", { ok: true });
    await expect(notification).resolves.toEqual(
      {
        kind: "notification",
        message: {
          method: "seen",
          params: { method: "client-ready", params: { ok: true } },
        },
      },
    );
  });

  it("surfaces structured RPC errors", async () => {
    client = new StdioAppServerClient({
      command: process.execPath,
      args: ["-e", fakeServer],
    });
    client.start();
    await expect(client.request("explode")).rejects.toEqual(
      expect.objectContaining<AppServerRpcError>({
        name: "AppServerRpcError",
        code: -32000,
        message: "boom",
        data: undefined,
      }),
    );
  });
});
