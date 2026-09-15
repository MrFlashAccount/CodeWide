import { describe, expect, it, vi } from "vitest";
import type { NewChatDraft } from "../src/features/navigation/threadNavigation";
import { parseThreadSelectionKey } from "../src/features/navigation/threadSelection";
import { createNewChatSubmission } from "../src/features/projects/newChatSubmission";

const draft: NewChatDraft = { id: "activation", serverId: "server", cwd: "/project", workspaceMode: "isolated" };
describe("new-chat admission binding", () => {
  it("keeps the original workspace activation through creation and publishes navigation only after admission", async () => {
    const created = Promise.withResolvers<string>();
    const admitted = Promise.withResolvers<string>();
    const commands = {
      startThread: vi.fn().mockResolvedValue("unused"),
      startThreadInWorkspace: vi.fn().mockReturnValue(created.promise),
      sendText: vi.fn().mockReturnValue(admitted.promise),
    };
    const select = vi.fn();
    const submit = createNewChatSubmission(draft, commands, select);
    const sent = submit("message", { type: "start" }, {});
    expect(commands.startThreadInWorkspace).toHaveBeenCalledWith("server", "/project", "activation");
    expect(select).not.toHaveBeenCalled();
    created.resolve("thread");
    await vi.waitFor(() => expect(commands.sendText).toHaveBeenCalledWith(
      "server", "thread", "message", { type: "start" }, { workspaceRequestId: "activation" },
    ));
    expect(select).not.toHaveBeenCalled();
    admitted.resolve("command");
    expect(await sent).toBe("command");
    expect(parseThreadSelectionKey(select.mock.calls[0]?.[0])).toEqual({ connectionId: "server", threadId: "thread" });
    expect(select.mock.calls[0]?.[2]).toBe("server");
  });
  it("retains the draft destination when first-message admission fails", async () => {
    const commands = {
      startThread: vi.fn().mockResolvedValue("thread"),
      startThreadInWorkspace: vi.fn().mockResolvedValue("thread"),
      sendText: vi.fn().mockRejectedValue(new Error("admission failed")),
    };
    const select = vi.fn();
    await expect(createNewChatSubmission(draft, commands, select)("message", { type: "start" }, {}))
      .rejects.toThrow("admission failed");
    expect(select).not.toHaveBeenCalled();
  });
  it("passes existing submission options by reference when no isolated workspace is created", async () => {
    const commands = {
      startThread: vi.fn().mockResolvedValue("thread"),
      startThreadInWorkspace: vi.fn(),
      sendText: vi.fn().mockResolvedValue("command"),
    };
    const options = { model: "selected" };
    await createNewChatSubmission({ ...draft, workspaceMode: "current" }, commands, vi.fn())("message", { type: "start" }, options);
    expect(commands.sendText.mock.calls[0]?.[4]).toBe(options);
    expect(commands.startThreadInWorkspace).not.toHaveBeenCalled();
  });
});
