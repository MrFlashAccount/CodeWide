import { describe, expect, it, vi } from "vitest";

import {
  createThreadSummaryModel,
  projectThreadSummaryView,
  type ThreadSummaryViewRequest,
} from "../src/data/thread-summary-model";
import type { StoredThreadSummary } from "../src/data/thread-summary-types";

const request: ThreadSummaryViewRequest = {
  connectionId: "server",
  recentLimit: 2,
  archivedLimit: 2,
  selectedConnectionId: "server",
  selectedThreadId: "selected",
  subagentConnectionId: "server",
  subagentLimit: 2,
};

function summary(id: string, overrides: Partial<StoredThreadSummary> = {}): StoredThreadSummary {
  return {
    connectionId: "server",
    remoteThreadId: id,
    parentThreadId: null,
    name: id,
    preview: id,
    cwd: "/repo",
    updatedAt: 1,
    recencyAt: 1,
    status: { type: "idle" },
    pinned: false,
    archived: false,
    pendingRequestCount: 0,
    latestActivityCursor: 0,
    lastSeenCursor: 0,
    unread: 0,
    provisionalThread: null,
    deleteCommandId: null,
    ...overrides,
  };
}

describe("Legend thread summary model", () => {
  it("starts one lazy Legend resource and resolves it into the live view", async () => {
    const model = createThreadSummaryModel();
    let loads = 0;
    const resource = model.resource(request, async () => {
      loads += 1;
      return projectThreadSummaryView([summary("cached")], request);
    });
    const same = model.resource(request, async () => {
      loads += 1;
      return projectThreadSummaryView([summary("duplicate")], request);
    });

    await resource.ready$.peek();

    expect(same.ready$).toBe(resource.ready$);
    expect(loads).toBe(1);
    expect(resource.view$.peek().recent[0]?.remoteThreadId).toBe("cached");
  });

  it("keeps list and conversation views as independent resource owners", async () => {
    const model = createThreadSummaryModel();
    const listRequest = { ...request, viewId: "list", selectedConnectionId: null, selectedThreadId: null };
    const conversationRequest = { ...request, viewId: "conversation", recentLimit: 0, archivedLimit: 0 };
    let resolveConversation!: (value: ReturnType<typeof projectThreadSummaryView>) => void;
    const conversationLoad = new Promise<ReturnType<typeof projectThreadSummaryView>>((resolve) => {
      resolveConversation = resolve;
    });
    const list = model.resource(listRequest, async () => projectThreadSummaryView([summary("list")], listRequest));
    const conversation = model.resource(conversationRequest, async () => await conversationLoad);

    expect(conversation.ready$).not.toBe(list.ready$);
    expect(conversation.view$).not.toBe(list.view$);
    await list.ready$.peek();
    expect(list.view$.peek().recent.map(({ remoteThreadId }) => remoteThreadId)).toEqual(["list"]);
    expect(conversation.view$.peek().selected).toEqual([]);

    resolveConversation(projectThreadSummaryView([summary("selected")], conversationRequest));
    await conversation.ready$.peek();
    expect(conversation.view$.peek().selected.map(({ remoteThreadId }) => remoteThreadId)).toEqual(["selected"]);
    expect(list.view$.peek().recent.map(({ remoteThreadId }) => remoteThreadId)).toEqual(["list"]);
  });

  it("does not let the previous conversation cleanup evict the destination resource", async () => {
    const model = createThreadSummaryModel();
    const firstRequest = {
      ...request,
      viewId: "conversation:server:first",
      recentLimit: 0,
      archivedLimit: 0,
      selectedThreadId: "first",
    };
    const secondRequest = {
      ...request,
      viewId: "conversation:server:second",
      recentLimit: 0,
      archivedLimit: 0,
      selectedThreadId: "second",
    };
    const releaseFirst = model.retainView(firstRequest);
    const first = model.resource(firstRequest, async () => projectThreadSummaryView([summary("first")], firstRequest));
    await first.ready$.peek();

    let resolveSecond!: (value: ReturnType<typeof projectThreadSummaryView>) => void;
    const secondLoad = new Promise<ReturnType<typeof projectThreadSummaryView>>((resolve) => {
      resolveSecond = resolve;
    });
    const second = model.resource(secondRequest, async () => await secondLoad);

    // React runs the previous passive cleanup before retaining the newly
    // committed destination. Different destination owners make that cleanup
    // incapable of deleting the new resource.
    releaseFirst();
    const releaseSecond = model.retainView(secondRequest);
    resolveSecond(projectThreadSummaryView([summary("second")], secondRequest));
    await second.ready$.peek();

    expect(second.view$.peek().selected.map(({ remoteThreadId }) => remoteThreadId)).toEqual(["second"]);
    expect(model.activeRequests()).toContainEqual(secondRequest);
    releaseSecond();
  });

  it("keeps the current list while a larger range loads", async () => {
    const model = createThreadSummaryModel();
    const first = model.resource(request, async () => projectThreadSummaryView([summary("first")], request));
    await first.ready$.peek();
    const expandedRequest = { ...request, recentLimit: 3 };
    let resolveExpanded!: (value: ReturnType<typeof projectThreadSummaryView>) => void;
    const expanded = new Promise<ReturnType<typeof projectThreadSummaryView>>((resolve) => {
      resolveExpanded = resolve;
    });

    model.resource(expandedRequest, async () => await expanded);

    expect(model.view$(expandedRequest).peek().recent.map(({ remoteThreadId }) => remoteThreadId)).toEqual(["first"]);
    resolveExpanded(projectThreadSummaryView([summary("first"), summary("second", { recencyAt: 2 })], expandedRequest));
    await vi.waitFor(() => {
      expect(model.view$(expandedRequest).peek().recent.map(({ remoteThreadId }) => remoteThreadId)).toEqual(["second", "first"]);
    });
  });

  it("keeps equivalent SQLite rows and arrays referentially stable", () => {
    const model = createThreadSummaryModel();
    const generation = model.startView(request);
    model.commitView(request, generation, projectThreadSummaryView([summary("thread")], request));
    const previous = model.view$(request).peek();
    const previousRow = previous.recent[0];

    const refresh = model.startView(request);
    model.commitView(request, refresh, structuredClone(projectThreadSummaryView([summary("thread")], request)));
    const next = model.view$(request).peek();

    expect(next).toBe(previous);
    expect(next.recent).toBe(previous.recent);
    expect(next.recent[0]).toBe(previousRow);
  });

  it("keeps an initial request suspended when a newer required selection supersedes it", async () => {
    const model = createThreadSummaryModel();
    let resolveFirst!: (value: ReturnType<typeof projectThreadSummaryView>) => void;
    let resolveSelected!: (value: ReturnType<typeof projectThreadSummaryView>) => void;
    const firstLoad = new Promise<ReturnType<typeof projectThreadSummaryView>>((resolve) => { resolveFirst = resolve; });
    const selectedLoad = new Promise<ReturnType<typeof projectThreadSummaryView>>((resolve) => { resolveSelected = resolve; });
    const first = model.resource({ ...request, selectedThreadId: null }, async () => await firstLoad);
    const selectedRequest = { ...request, selectedThreadId: "outside-current-range" };
    const selected = model.resource(selectedRequest, async () => await selectedLoad);

    expect(selected.ready$).not.toBe(first.ready$);
    resolveFirst(projectThreadSummaryView([summary("first")], { ...request, selectedThreadId: null }));
    await first.ready$.peek();
    expect(model.view$(selectedRequest).peek().requestKey).toBeNull();

    resolveSelected(projectThreadSummaryView([summary("outside-current-range")], selectedRequest));
    await selected.ready$.peek();
    expect(model.view$(selectedRequest).peek().selected[0]?.remoteThreadId).toBe("outside-current-range");
  });

  it("retries a failed background range without clearing the resident list", async () => {
    const model = createThreadSummaryModel();
    const initialRequest = { ...request, selectedConnectionId: null, selectedThreadId: null };
    await model.resource(initialRequest, async () => projectThreadSummaryView([summary("first")], initialRequest)).ready$.peek();
    const expandedRequest = { ...initialRequest, recentLimit: 3 };
    let attempts = 0;
    model.resource(expandedRequest, async () => {
      attempts += 1;
      if (attempts === 1) throw new Error("disk busy");
      return projectThreadSummaryView([summary("first"), summary("second", { recencyAt: 2 })], expandedRequest);
    });

    await vi.waitFor(() => expect(model.view$(expandedRequest).peek().error).toBe("disk busy"));
    expect(model.view$(expandedRequest).peek().recent.map(({ remoteThreadId }) => remoteThreadId)).toEqual(["first"]);
    await vi.waitFor(() => expect(attempts).toBe(2), { timeout: 1_000 });
    await vi.waitFor(() => expect(model.view$(expandedRequest).peek().recent.map(({ remoteThreadId }) => remoteThreadId)).toEqual(["second", "first"]));
  });

  it("does not let an initial SQLite result overwrite a live summary update", async () => {
    const model = createThreadSummaryModel();
    let resolveLoad!: (value: ReturnType<typeof projectThreadSummaryView>) => void;
    const load = new Promise<ReturnType<typeof projectThreadSummaryView>>((resolve) => {
      resolveLoad = resolve;
    });
    const resource = model.resource(request, async () => await load);
    model.publish([{ type: "update", value: summary("thread", { preview: "live", recencyAt: 2 }) }]);

    resolveLoad(projectThreadSummaryView([summary("thread", { preview: "stale" })], request));
    await resource.ready$.peek();

    expect(resource.view$.peek().recent[0]?.preview).toBe("live");
  });

  it("projects bounded roots, selected rows, and subagents as one snapshot", () => {
    const projected = projectThreadSummaryView([
      summary("recent-1", { recencyAt: 1 }),
      summary("recent-2", { recencyAt: 2 }),
      summary("recent-3", { recencyAt: 3 }),
      summary("pinned", { pinned: true }),
      summary("selected", { archived: true }),
      summary("subagent", { parentThreadId: "selected", recencyAt: 4 }),
      summary("other-server", { connectionId: "other", recencyAt: 99 }),
    ], request);

    expect(projected.pinned.map(({ remoteThreadId }) => remoteThreadId)).toEqual(["pinned"]);
    expect(projected.recent.map(({ remoteThreadId }) => remoteThreadId)).toEqual(["recent-3", "recent-2"]);
    expect(projected.archived.map(({ remoteThreadId }) => remoteThreadId)).toEqual(["selected"]);
    expect(projected.selected.map(({ remoteThreadId }) => remoteThreadId)).toEqual(["selected"]);
    expect(projected.subagents.map(({ remoteThreadId }) => remoteThreadId)).toEqual(["subagent"]);
  });

  it("keeps the last complete local snapshot while a refresh is pending or fails", () => {
    const model = createThreadSummaryModel();
    const generation = model.startView(request);
    model.commitView(request, generation, projectThreadSummaryView([summary("recent")], request));

    const refresh = model.startView(request);
    expect(model.view$(request).peek().phase).toBe("ready");
    expect(model.view$(request).peek().recent.map(({ remoteThreadId }) => remoteThreadId)).toEqual(["recent"]);

    model.failView(request, refresh, new Error("disk busy"));
    expect(model.view$(request).peek()).toMatchObject({ phase: "ready", error: "disk busy" });
    expect(model.view$(request).peek().recent.map(({ remoteThreadId }) => remoteThreadId)).toEqual(["recent"]);
  });

  it("publishes live summary changes without clearing the resident list", () => {
    const model = createThreadSummaryModel();
    const generation = model.startView(request);
    model.commitView(request, generation, projectThreadSummaryView([
      summary("older", { recencyAt: 1 }),
      summary("newer", { recencyAt: 2 }),
    ], request));

    model.publish([{ type: "update", value: summary("older", { recencyAt: 3, preview: "streamed" }) }]);

    expect(model.view$(request).peek().recent.map(({ remoteThreadId }) => remoteThreadId)).toEqual(["older", "newer"]);
    expect(model.view$(request).peek().recent[0]?.preview).toBe("streamed");
  });

  it("rejects an obsolete SQLite result", () => {
    const model = createThreadSummaryModel();
    const stale = model.startView(request);
    const fresh = model.startView(request);
    expect(model.commitView(request, stale, projectThreadSummaryView([summary("stale")], request))).toBe(false);
    expect(model.commitView(request, fresh, projectThreadSummaryView([summary("fresh")], request))).toBe(true);
    expect(model.view$(request).peek().recent[0]?.remoteThreadId).toBe("fresh");
  });
});
