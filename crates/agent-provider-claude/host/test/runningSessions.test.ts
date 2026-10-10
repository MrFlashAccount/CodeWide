/** `claude agents --json` output → the ids of the running sessions. */

import { describe, expect, it } from "vitest";
import { parseRunningSessions } from "../src/claude/cliRunningSessions.js";

describe("running sessions from the claude CLI", () => {
  it("takes every entry's sessionId and skips entries without one", () => {
    const output = JSON.stringify([
      {
        cwd: "/home/user",
        id: "48d313bf",
        kind: "background",
        name: "Review",
        pid: 3_226_754,
        sessionId: "48d313bf-0ef1-44f9-a458-bd7bb443b8d1",
        state: "done",
        status: "idle",
      },
      { kind: "interactive", pid: 2_203_797, sessionId: "01a12320-fa11-7ba5-b9fc-a190b32c8824" },
      { kind: "interactive", pid: 1 },
    ]);
    expect([...parseRunningSessions(output)]).toEqual([
      "48d313bf-0ef1-44f9-a458-bd7bb443b8d1",
      "01a12320-fa11-7ba5-b9fc-a190b32c8824",
    ]);
  });

  it("rejects output that is not an array", () => {
    expect(() => parseRunningSessions("{}")).toThrow("did not print an array");
  });
});
