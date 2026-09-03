import { describe, expect, it, jest } from "@jest/globals";
import { fireEvent, render, screen, waitFor } from "@testing-library/react-native";
import { Text } from "react-native";

import type { SyncV2Session, V2ProjectionChange, V2QueryResult } from "@codewide/sync-client/v2";
import { SyncV2RequestError } from "@codewide/sync-client/v2";
import type { V2Runtime } from "../src/v2/application/v2Runtime";
import { V2RuntimeProvider } from "../src/v2/application/react/V2RuntimeContext";
import { useLiveQuery } from "../src/v2/application/react/useLiveQuery";
import type { ProjectionResource } from "../src/v2/application/resources/projectionResource";
import { QueryResource } from "../src/v2/application/resources/queryResource";
import { ObservableResource, ReloadableResource } from "../src/v2/application/resources/resource";
import { savedServerId, threadId } from "../src/v2/domain/ids";
import { qualifiedThread } from "../src/v2/domain/qualifiedThread";
import { V2QueryBoundary } from "../src/v2/features/shared/V2QueryBoundary";
import { TerminalScreen } from "../src/v2/features/terminal/TerminalScreen";
import { useV2RuntimeLifecycle } from "../src/v2/infrastructure/react/useV2RuntimeLifecycle";

const serverId = savedServerId("saved-server-a");
const owner = qualifiedThread(serverId, threadId("thread-a"));

describe("V2 resource failures", () => {
  it("propagates a query-session opening failure through useLiveQuery", async () => {
    const runtime = queryRuntime(failingResource<QueryResource | null>());

    render(
      <V2RuntimeProvider runtime={runtime}>
        <QueryProbe runtime={runtime} />
      </V2RuntimeProvider>,
    );

    expect(await screen.findByText("Could not open saved server")).toBeTruthy();
  });

  it("shows and retries an outer V2QueryBoundary failure", async () => {
    const result = new ReloadableResource<QueryResource | null>({
      errorMessage: "Could not open saved server",
      initialValue: null,
      load: jest
        .fn<() => Promise<QueryResource>>()
        .mockRejectedValueOnce(new Error("offline"))
        .mockResolvedValueOnce(readyQueryResource()),
    });
    result.start();

    render(
      <V2RuntimeProvider runtime={queryRuntime(result)}>
        <V2QueryBoundary
          chrome="none"
          query={{ kind: "models.list" }}
          savedServerId={serverId}
          title="models"
        >
          {() => <Text>Models loaded</Text>}
        </V2QueryBoundary>
      </V2RuntimeProvider>,
    );

    fireEvent.press(await screen.findByLabelText("Try again"));
    expect(await screen.findByText("Models loaded")).toBeTruthy();
  });

  it("shows the exact typed server query failure and retries the same resource", async () => {
    const detail = {
      code: "sourceUnavailable",
      message: "Observer is rebuilding this thread index",
      recovery: "retry",
    } as const;
    const query = jest
      .fn<() => Promise<V2QueryResult>>()
      .mockRejectedValueOnce(new SyncV2RequestError(detail))
      .mockResolvedValueOnce({ kind: "models.list", models: [] });
    const session = querySession(query);
    const resource = new QueryResource(session, { kind: "models.list" });
    const runtime = queryRuntime(readyResource<QueryResource | null>(resource));

    render(
      <V2RuntimeProvider runtime={runtime}>
        <V2QueryBoundary
          chrome="none"
          query={{ kind: "models.list" }}
          savedServerId={serverId}
          title="models"
        >
          {() => <Text>Models loaded</Text>}
        </V2QueryBoundary>
      </V2RuntimeProvider>,
    );

    expect(await screen.findByText(detail.message)).toBeTruthy();
    fireEvent.press(screen.getByLabelText("Try again"));
    expect(await screen.findByText("Models loaded")).toBeTruthy();
  });

  it("shows and retries a mismatched query result instead of rendering a blank screen", async () => {
    const query = jest
      .fn<() => Promise<V2QueryResult>>()
      .mockResolvedValueOnce({
        activeProfileId: null,
        allExhausted: false,
        kind: "accounts.list",
        profiles: [],
      })
      .mockResolvedValueOnce({ kind: "models.list", models: [] });
    const resource = new QueryResource(querySession(query), { kind: "models.list" });
    const runtime = queryRuntime(readyResource<QueryResource | null>(resource));

    render(
      <V2RuntimeProvider runtime={runtime}>
        <V2QueryBoundary
          chrome="none"
          query={{ kind: "models.list" }}
          savedServerId={serverId}
          title="models"
        >
          {() => <Text>Models loaded</Text>}
        </V2QueryBoundary>
      </V2RuntimeProvider>,
    );

    expect(
      await screen.findByText(
        "Protocol error: expected models.list query result, received accounts.list",
      ),
    ).toBeTruthy();
    expect(screen.queryByText("Models loaded")).toBeNull();
    fireEvent.press(screen.getByLabelText("Try again"));
    expect(await screen.findByText("Models loaded")).toBeTruthy();
  });

  it("does not turn a terminal opening failure into empty content with a dead Create button", async () => {
    const projection = failingResource<ProjectionResource | null>();
    const runtime = projectionRuntime(projection);

    render(
      <V2RuntimeProvider runtime={runtime}>
        <TerminalScreen owner={owner} />
      </V2RuntimeProvider>,
    );

    expect(await screen.findByText("Could not open saved server")).toBeTruthy();
    expect(screen.getByLabelText("Try again")).toBeTruthy();
  });

  it("shows terminal route loading while a non-null projection session is still opening", () => {
    const projection = terminalProjection("ready");
    const opening = deferred<ProjectionResource>();
    const outer = new ReloadableResource<ProjectionResource | null>({
      errorMessage: "Could not open saved server",
      initialValue: projection,
      load: () => opening.promise,
    });

    const rendered = render(
      <V2RuntimeProvider runtime={projectionRuntime(outer)}>
        <TerminalScreen owner={owner} />
      </V2RuntimeProvider>,
    );

    expect(screen.getByText("Loading terminal…")).toBeTruthy();
    expect(outer.snapshot().status).toBe("loading");
    rendered.unmount();
    opening.resolve(projection);
  });

  it("keeps terminal route loading until the requested thread becomes authoritative", async () => {
    const projection = terminalProjection("loading");
    const outer = readyResource<ProjectionResource | null>(projection);
    await outer.refresh();

    render(
      <V2RuntimeProvider runtime={projectionRuntime(outer)}>
        <TerminalScreen owner={owner} />
      </V2RuntimeProvider>,
    );

    expect(screen.getByText("Loading terminal…")).toBeTruthy();
    expect(outer.snapshot().status).toBe("ready");
  });

  it("surfaces runtime startup failure and permits a fresh runtime to start", async () => {
    const failed = lifecycleRuntime(async () => {
      throw new Error("secure storage unavailable");
    });
    const recovered = lifecycleRuntime(async () => undefined);
    const rendered = render(<LifecycleProbe runtime={failed.runtime} />);

    expect(await screen.findByText("Could not start CodeWide V2")).toBeTruthy();
    rendered.rerender(<LifecycleProbe runtime={recovered.runtime} />);
    expect(await screen.findByText("ready")).toBeTruthy();

    rendered.unmount();
    await waitFor(() => expect(recovered.stop).toHaveBeenCalledTimes(1));
  });

  it("releases query session observers across repeated React mounts", async () => {
    const harness = querySessionHarness();
    const queryResource = new QueryResource(harness.session, { kind: "models.list" });
    const outer = readyResource<QueryResource | null>(queryResource);
    const runtime = queryRuntime(outer);

    for (let cycle = 0; cycle < 25; cycle += 1) {
      const rendered = render(
        <V2RuntimeProvider runtime={runtime}>
          <QueryProbe runtime={runtime} />
        </V2RuntimeProvider>,
      );
      await screen.findByText("ready");
      expect(harness.listenerCounts()).toEqual({ changes: 1, state: 1 });
      rendered.unmount();
      expect(harness.listenerCounts()).toEqual({ changes: 0, state: 0 });
    }
  });

  it("stops every retained runtime after repeated application mounts", async () => {
    for (let cycle = 0; cycle < 10; cycle += 1) {
      const current = lifecycleRuntime(async () => undefined);
      const rendered = render(<LifecycleProbe runtime={current.runtime} />);

      expect(await screen.findByText("ready")).toBeTruthy();
      rendered.unmount();
      await waitFor(() => expect(current.stop).toHaveBeenCalledTimes(1));
    }
  });
});

function QueryProbe(props: { runtime: V2Runtime }): React.JSX.Element {
  const snapshot = useLiveQuery(props.runtime, serverId, { kind: "models.list" });
  return <Text>{snapshot.status === "error" ? snapshot.message : snapshot.status}</Text>;
}

function LifecycleProbe(props: { runtime: V2Runtime }): React.JSX.Element {
  const snapshot = useV2RuntimeLifecycle(props.runtime, true);
  return <Text>{snapshot.status === "error" ? snapshot.message : snapshot.status}</Text>;
}

function failingResource<T>(): ReloadableResource<T | null> {
  const resource = new ReloadableResource<T | null>({
    errorMessage: "Could not open saved server",
    initialValue: null,
    load: async () => {
      throw new Error("offline");
    },
  });
  resource.start();
  return resource;
}

function projectionRuntime(resource: ReloadableResource<ProjectionResource | null>): V2Runtime {
  // WHY: the screen reaches only the projection port before rendering the explicit error state.
  return { projection: () => resource } as unknown as V2Runtime;
}

function queryRuntime(resource: ReloadableResource<QueryResource | null>): V2Runtime {
  // WHY: the query boundary reaches only the query port before rendering the explicit error state.
  return { query: () => resource } as unknown as V2Runtime;
}

function readyQueryResource(): QueryResource {
  const resource = new ReloadableResource<V2QueryResult | null>({
    errorMessage: "Could not read models",
    initialValue: null,
    load: async () => ({ kind: "models.list", models: [] }),
  });
  resource.start();
  // WHY: the test resource exposes the exact subscribe/snapshot/refresh surface consumed by the boundary.
  return resource as unknown as QueryResource;
}

function readyResource<T>(value: T): ReloadableResource<T> {
  const resource = new ReloadableResource<T>({
    errorMessage: "not expected",
    initialValue: value,
    load: async () => value,
  });
  resource.start();
  return resource;
}

function terminalProjection(authority: "loading" | "ready"): ProjectionResource {
  const value = {
    operations: [],
    projections: {
      live: {
        currentThread: {
          newerCursor: null,
          olderCursor: null,
          thread: {
            id: owner.threadId,
            settings: {
              approvalPolicy: "never",
              effort: "high",
              model: "gpt-5.6-sol",
              personality: null,
              sandbox: "unrestricted",
            },
            title: "Terminal thread",
            workspace: "/workspace/project",
          },
          turns: [],
        },
        sourceGeneration: "1",
      },
      retained: null,
    },
    state: "live",
    version: 1,
  } as const;
  const resource = Object.assign(new ObservableResource(value), {
    requestedThreadAuthority: () => ({
      message: null,
      status: authority,
      threadId: owner.threadId,
    }),
  });
  resource.publish({ status: "ready", value });
  // WHY: this focused route test needs only the projection subscription and thread-authority ports.
  return resource as unknown as ProjectionResource;
}

function deferred<T>(): { promise: Promise<T>; resolve(value: T): void } {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((complete) => {
    resolve = complete;
  });
  return { promise, resolve };
}

function querySessionHarness(): {
  listenerCounts(): { changes: number; state: number };
  session: SyncV2Session;
} {
  const stateListeners = new Set<() => void>();
  const changeListeners = new Set<(change: V2ProjectionChange) => void>();
  const session = {
    query: async () => ({ kind: "models.list", models: [] }),
    state: "live",
    subscribe(listener: () => void): () => void {
      stateListeners.add(listener);
      return () => stateListeners.delete(listener);
    },
    subscribeChange(listener: (change: V2ProjectionChange) => void): () => void {
      changeListeners.add(listener);
      return () => changeListeners.delete(listener);
    },
  } as unknown as SyncV2Session;
  return {
    listenerCounts: () => ({ changes: changeListeners.size, state: stateListeners.size }),
    session,
  };
}

function querySession(query: () => Promise<V2QueryResult>): SyncV2Session {
  return {
    query,
    state: "live",
    subscribe: () => () => undefined,
    subscribeChange: () => () => undefined,
  } as unknown as SyncV2Session;
}

function lifecycleRuntime(start: () => Promise<void>): {
  runtime: V2Runtime;
  stop: ReturnType<typeof jest.fn<() => Promise<void>>>;
} {
  const stop = jest.fn(async () => undefined);
  // WHY: runtime-slot behavior depends only on the lifecycle handle's start and stop methods.
  const runtime = { start, stop } as unknown as V2Runtime;
  return { runtime, stop };
}
