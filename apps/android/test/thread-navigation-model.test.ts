import { describe, expect, it } from "vitest";

import { createThreadNavigationModel } from "../src/data/thread-navigation-model";

describe("thread navigation model", () => {
  it("keeps repeated selection stable unless an explicit reload is requested", () => {
    const model = createThreadNavigationModel();

    expect(model.current()).toEqual({ id: null, generation: 0 });
    const selected = model.select("server\u0000thread");
    expect(selected).toEqual({ id: "server\u0000thread", generation: 1 });
    expect(model.select("server\u0000thread")).toBe(selected);
    expect(model.select("server\u0000thread", true)).toEqual({ id: "server\u0000thread", generation: 2 });
  });

  it("publishes one scalar selection that rows can observe independently", () => {
    const model = createThreadNavigationModel();
    const ids: Array<string | null> = [];
    const dispose = model.selection$.id.onChange(({ value }) => ids.push(value));

    model.select("server\u0000first");
    model.select("server\u0000second");
    dispose();

    expect(ids).toEqual(["server\u0000first", "server\u0000second"]);
  });
});
