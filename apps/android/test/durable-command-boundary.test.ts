import { describe, expect, it, vi } from "vitest";

import { commitNativeThenProject } from "../src/data/durable-command-boundary";

describe("durable command boundary", () => {
  it("rolls the optimistic action back when native persistence rejects", async () => {
    const projection = vi.fn();
    await expect(commitNativeThenProject(
      async () => { throw new Error("native store full"); },
      projection,
    )).rejects.toThrow("native store full");
    expect(projection).not.toHaveBeenCalled();
  });

  it("does not reject an already accepted command when the UI cache fails", async () => {
    const report = vi.fn();
    await expect(commitNativeThenProject(
      async () => "accepted",
      async () => { throw new Error("sqlite busy"); },
      report,
    )).resolves.toBe("accepted");
    expect(report).toHaveBeenCalledOnce();
  });

  it("projects only after durable native acceptance", async () => {
    const order: string[] = [];
    await commitNativeThenProject(
      async () => { order.push("native"); return undefined; },
      async () => { order.push("ui"); },
    );
    expect(order).toEqual(["native", "ui"]);
  });
});
