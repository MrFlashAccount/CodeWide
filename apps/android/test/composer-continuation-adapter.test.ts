import { describe, expect, it, vi } from "vitest";
import { RpcResponseError } from "@codewide/sync-client";
import { createComposerContinuationAdapter } from "../src/features/composer/continuationAdapter";

function binding() {
  const session = { rpc: vi.fn(), stop: vi.fn() };
  const rpcAfterAttach = vi.fn();
  const continueTurn = createComposerContinuationAdapter({ getSession: () => session, rpcAfterAttach });
  return { continueTurn, rpcAfterAttach };
}
const page = (status = "interrupted", id = "stopped") => ({ data: [{ id, status }] });
const started = { turn: { id: "continued", status: "inProgress" } };

describe("message-free composer continuation", () => {
  it.each(["interrupted", "failed"])("continues %s history in the same thread without a user message", async status => {
    const test = binding();
    test.rpcAfterAttach.mockResolvedValueOnce(page(status)).mockResolvedValueOnce(started);
    await test.continueTurn("server", "thread", "stopped");
    expect(test.rpcAfterAttach.mock.calls.map(([, method, params]) => [method, params])).toEqual([
      ["thread/turns/list", { threadId: "thread", limit: 1, sortDirection: "desc", itemsView: "summary" }],
      ["turn/start", { threadId: "thread", input: [] }],
    ]);
  });

  it("admits only one start for simultaneous taps and stale remounts", async () => {
    const test = binding();
    const ack = Promise.withResolvers<unknown>();
    test.rpcAfterAttach.mockResolvedValueOnce(page()).mockReturnValueOnce(ack.promise);
    const first = test.continueTurn("server", "thread", "stopped");
    const second = test.continueTurn("server", "thread", "stopped");
    await Promise.resolve();
    ack.resolve(started);
    await Promise.all([first, second]);
    await test.continueTurn("server", "thread", "stopped");
    expect(test.rpcAfterAttach).toHaveBeenCalledTimes(2);
  });

  it.each([page("completed"), page("inProgress"), page("failed", "newer"), { data: [] }, { data: null }])(
    "refuses a stale or invalid latest outcome %#", async value => {
      const test = binding();
      test.rpcAfterAttach.mockResolvedValue(value);
      await expect(test.continueTurn("server", "thread", "stopped")).rejects.toThrow();
      expect(test.rpcAfterAttach).toHaveBeenCalledTimes(1);
    },
  );

  it("allows retry after explicit input rejection", async () => {
    const test = binding();
    test.rpcAfterAttach.mockResolvedValueOnce(page()).mockRejectedValueOnce(new RpcResponseError(-32602, "Rejected input"));
    await expect(test.continueTurn("server", "thread", "stopped")).rejects.toThrow("Rejected input");
    test.rpcAfterAttach.mockResolvedValueOnce(page()).mockResolvedValueOnce(started);
    await test.continueTurn("server", "thread", "stopped");
    expect(test.rpcAfterAttach).toHaveBeenCalledTimes(4);
  });

  it.each([new Error("RPC timed out"), new RpcResponseError(-32040, "Upstream disconnected"), { turn: null }])(
    "never repeats an uncertain start %#", async failure => {
      const test = binding();
      test.rpcAfterAttach.mockResolvedValueOnce(page());
      if (failure instanceof Error) test.rpcAfterAttach.mockRejectedValueOnce(failure);
      else test.rpcAfterAttach.mockResolvedValueOnce(failure);
      await expect(test.continueTurn("server", "thread", "stopped")).rejects.toThrow("could not be confirmed");
      await expect(test.continueTurn("server", "thread", "stopped")).rejects.toThrow("could not be confirmed");
      expect(test.rpcAfterAttach).toHaveBeenCalledTimes(2);
    },
  );

  it("keeps requests qualified by connection/thread and admits a later interrupted turn", async () => {
    const test = binding();
    test.rpcAfterAttach.mockResolvedValueOnce(page()).mockResolvedValueOnce(started)
      .mockResolvedValueOnce(page()).mockResolvedValueOnce(started)
      .mockResolvedValueOnce(page("failed", "later")).mockResolvedValueOnce(started);
    await test.continueTurn("first", "thread", "stopped");
    await test.continueTurn("second", "thread", "stopped");
    await test.continueTurn("first", "thread", "later");
    expect(test.rpcAfterAttach).toHaveBeenCalledTimes(6);
  });
});
