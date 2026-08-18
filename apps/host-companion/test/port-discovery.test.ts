import { describe, expect, it } from "vitest";

import { parseSsListeners } from "../src/port-discovery.js";

describe("port discovery", () => {
  it("parses IPv4 listeners with and without process metadata", () => {
    expect(parseSsListeners([
      'LISTEN 0 511 127.0.0.1:5173 0.0.0.0:* users:(("node",pid=4242,fd=19))',
      "LISTEN 0 4096 0.0.0.0:8765 0.0.0.0:*",
      "LISTEN 0 128 127.0.0.1:70000 0.0.0.0:*",
    ].join("\n"))).toEqual([
      { port: 5173, process: "node", pid: 4242 },
      { port: 8765, process: null, pid: null },
    ]);
  });
});
