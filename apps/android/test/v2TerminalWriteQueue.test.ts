import { describe, expect, it, vi } from "vitest";

import { TerminalWriteQueue } from "../src/v2/infrastructure/react/terminal/terminalWriteQueue";

const FAILURE_AND_REPLAY_WRITES = 2;

describe("V2 terminal mounted write queue", () => {
  it("accepts exact replay after one mounted write rejects", async () => {
    const queue = new TerminalWriteQueue();
    const mountedWrite = vi
      .fn<() => Promise<void>>()
      .mockRejectedValueOnce(new Error("Ghostty write failed"))
      .mockResolvedValueOnce();

    await expect(queue.run(mountedWrite)).rejects.toThrow("Ghostty write failed");
    await expect(queue.run(mountedWrite)).resolves.toBeUndefined();

    expect(mountedWrite).toHaveBeenCalledTimes(FAILURE_AND_REPLAY_WRITES);
  });
});
