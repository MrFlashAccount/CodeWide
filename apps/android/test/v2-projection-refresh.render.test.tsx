import { describe, expect, it, jest } from "@jest/globals";
import { act, render, screen } from "@testing-library/react-native";
import { useSyncExternalStore } from "react";

import {
  MemoryV2OperationStore,
  MemoryV2ProjectionStore,
  type V2Projection,
} from "@codewide/sync-client/v2";
import { ProjectionResource } from "../src/v2/application/resources/projectionResource";
import { WorkspaceSubtitleView, WorkspaceView } from "../src/v2/presentation/layouts/WorkspaceView";

describe("V2 projection refresh header", () => {
  it("shows Updating only while real overlapping projection reads are in flight", async () => {
    const older = deferred<V2Projection | null>();
    const newer = deferred<V2Projection | null>();
    const store = new MemoryV2ProjectionStore();
    jest
      .spyOn(store, "retained")
      .mockImplementationOnce(() => older.promise)
      .mockImplementationOnce(() => newer.promise);
    const resource = new ProjectionResource("saved-server", store, new MemoryV2OperationStore());
    render(<ProjectionHeaderProbe resource={resource} />);

    expect(screen.getByText("Buddy · workspace")).toBeTruthy();
    let olderRefresh!: Promise<void>;
    let newerRefresh!: Promise<void>;
    act(() => {
      olderRefresh = resource.refresh();
      newerRefresh = resource.refresh();
    });
    expect(screen.getByLabelText("Updating")).toBeTruthy();
    expect(screen.queryByText("Buddy · workspace")).toBeNull();

    await act(async () => {
      newer.reject(new Error("latest read failed"));
      await newerRefresh;
    });
    expect(resource.snapshot().status).toBe("error");
    expect(screen.getByLabelText("Updating")).toBeTruthy();

    await act(async () => {
      older.resolve(null);
      await olderRefresh;
    });
    expect(screen.queryByLabelText("Updating")).toBeNull();
    expect(screen.getByText("Buddy · workspace")).toBeTruthy();
  });
});

interface ProjectionHeaderProbeProps {
  resource: ProjectionResource;
}

function ProjectionHeaderProbe(props: ProjectionHeaderProbeProps): React.JSX.Element {
  const { resource } = props;
  const refresh = useSyncExternalStore(
    resource.subscribeRefresh,
    resource.refreshSnapshot,
    resource.refreshSnapshot,
  );
  return (
    <WorkspaceView
      subtitle={
        <WorkspaceSubtitleView
          text="Buddy · workspace"
          updating={refresh.status === "refreshing"}
        />
      }
      title="Conversation"
    />
  );
}

interface Deferred<T> {
  promise: Promise<T>;
  reject(cause: Error): void;
  resolve(value: T): void;
}

function deferred<T>(): Deferred<T> {
  let reject!: (cause: Error) => void;
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((complete, fail) => {
    reject = fail;
    resolve = complete;
  });
  return { promise, reject, resolve };
}
