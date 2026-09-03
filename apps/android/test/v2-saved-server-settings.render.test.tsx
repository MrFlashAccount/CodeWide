import { describe, expect, it, jest } from "@jest/globals";
import { act, fireEvent, render, screen } from "@testing-library/react-native";

import type { V2Runtime } from "../src/v2/application/v2Runtime";
import { V2RuntimeProvider } from "../src/v2/application/react/V2RuntimeContext";
import { VoiceInputController } from "../src/v2/application/voiceInputController";
import type { SavedServerConnection } from "../src/v2/application/ports/savedServerRepository";
import { ObservableResource } from "../src/v2/application/resources/resource";
import type { SavedServer } from "../src/v2/domain/savedServer";
import { savedServerId } from "../src/v2/domain/ids";
import { SavedServerSettingsScreen } from "../src/v2/features/settings/SavedServerSettingsScreen";

const SERVER_ID = savedServerId("removed-server");

describe("V2 saved server settings", () => {
  it("escapes a stale saved-server deep link instead of shimmering forever", () => {
    const leave = jest.fn();
    render(
      <V2RuntimeProvider runtime={missingServerRuntime()}>
        <SavedServerSettingsScreen onDeleted={leave} savedServerId={SERVER_ID} />
      </V2RuntimeProvider>,
    );

    expect(screen.getByText("This saved server no longer exists.")).toBeTruthy();
    expect(screen.queryByText("Loading server settings…")).toBeNull();
    fireEvent.press(screen.getByLabelText("Back to servers"));
    expect(leave).toHaveBeenCalledTimes(1);
  });

  it("shows an exact move failure, suppresses duplicate activation and retries", async () => {
    const pending = deferred<void>();
    const moveSavedServer = jest
      .fn<() => Promise<void>>()
      .mockImplementationOnce(() => pending.promise)
      .mockResolvedValueOnce(undefined);
    renderSettings(readyServerRuntime({ moveSavedServer }));

    fireEvent.press(screen.getByLabelText("Actions for Server"));
    fireEvent.press(screen.getByLabelText("Actions for Server: Move up"));
    fireEvent.press(screen.getByLabelText("Actions for Server: Move up"));
    expect(moveSavedServer).toHaveBeenCalledTimes(1);
    expect(screen.getByText("Updating")).toBeTruthy();

    await act(async () => pending.reject(new Error("Saved server order changed remotely")));
    expect(screen.getByText("Saved server order changed remotely")).toBeTruthy();
    fireEvent.press(screen.getByLabelText("Retry failed action"));
    await act(async () => undefined);
    expect(moveSavedServer).toHaveBeenCalledTimes(2);
  });

  it("preserves precise TLS pin validation and keeps the form available for retry", async () => {
    const updateSavedServer = jest
      .fn<() => Promise<void>>()
      .mockRejectedValue(new Error("Companion identity pin must start with sha256/"));
    renderSettings(readyServerRuntime({ updateSavedServer }));

    fireEvent.press(screen.getByLabelText("Actions for Server"));
    fireEvent.press(screen.getByLabelText("Actions for Server: Edit server"));
    fireEvent.changeText(screen.getByLabelText("TLS pin for Server"), "invalid-pin");
    fireEvent.press(screen.getByLabelText("Save Server"));
    fireEvent.press(screen.getByLabelText("Save Server"));

    await screen.findByText("Companion identity pin must start with sha256/");
    expect(updateSavedServer).toHaveBeenCalledTimes(1);
    expect(screen.getByLabelText("TLS pin for Server").props.value).toBe("invalid-pin");
    fireEvent.press(screen.getByLabelText("Save Server"));
    await act(async () => undefined);
    expect(updateSavedServer).toHaveBeenCalledTimes(2);
  });

  it("keeps save pending until authoritative settings refresh resolves", async () => {
    const refresh = deferred<void>();
    const updateSavedServer = jest.fn<() => Promise<void>>().mockResolvedValue(undefined);
    renderSettings(
      readyServerRuntime({ refreshConnection: () => refresh.promise, updateSavedServer }),
    );

    fireEvent.press(screen.getByLabelText("Actions for Server"));
    fireEvent.press(screen.getByLabelText("Actions for Server: Edit server"));
    fireEvent.press(screen.getByLabelText("Save Server"));
    fireEvent.press(screen.getByLabelText("Save Server"));
    expect(updateSavedServer).toHaveBeenCalledTimes(1);
    expect(screen.getByText("Save")).toBeTruthy();
    expect(screen.getByLabelText("TLS pin for Server")).toBeTruthy();

    await act(async () => refresh.resolve());
    expect(screen.queryByLabelText("TLS pin for Server")).toBeNull();
    expect(screen.getByText("Server")).toBeTruthy();
  });
});

interface ReadyRuntimeOverrides {
  moveSavedServer?: () => Promise<void>;
  refreshConnection?: () => Promise<void>;
  updateSavedServer?: () => Promise<void>;
}

function renderSettings(runtime: V2Runtime): ReturnType<typeof render> {
  return render(
    <V2RuntimeProvider runtime={runtime}>
      <SavedServerSettingsScreen onDeleted={jest.fn()} savedServerId={SERVER_ID} />
    </V2RuntimeProvider>,
  );
}

function readyServerRuntime(overrides: ReadyRuntimeOverrides): V2Runtime {
  const connection = Object.assign(
    new ObservableResource<SavedServerConnection | null>({
      enabled: true,
      endpoint: "https://companion.test",
      id: SERVER_ID,
      tlsPinSha256: "sha256/current",
    }),
    { refresh: overrides.refreshConnection ?? jest.fn().mockResolvedValue(undefined) },
  );
  const servers = new ObservableResource<SavedServer[]>([
    {
      displayName: "Server",
      emoji: "🖥️",
      enabled: true,
      endpoint: "https://companion.test",
      id: SERVER_ID,
    },
  ]);
  const statuses = new ObservableResource(new Map());
  const session = new ObservableResource({
    operations: [],
    projections: { live: null, retained: null },
    state: "offline" as const,
    version: 1,
  });
  connection.publish({ status: "ready", value: connection.snapshot().value });
  servers.publish({ status: "ready", value: servers.snapshot().value });
  statuses.publish({ status: "ready", value: new Map() });
  return {
    connectionStatuses: statuses,
    moveSavedServer: overrides.moveSavedServer ?? jest.fn().mockResolvedValue(undefined),
    reconnect: jest.fn(),
    savedServerConnection: () => connection,
    savedServers: servers,
    sessions: { resource: () => session },
    updateSavedServer: overrides.updateSavedServer ?? jest.fn().mockResolvedValue(undefined),
    voice: new VoiceInputController({
      start: async () => ({ cancel: async () => undefined, finish: async () => undefined }),
    }),
  } as unknown as V2Runtime;
}

interface Deferred<T> {
  promise: Promise<T>;
  reject(cause: unknown): void;
  resolve(value: T): void;
}

function deferred<T>(): Deferred<T> {
  let reject!: (cause: unknown) => void;
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((complete, fail) => {
    reject = fail;
    resolve = complete;
  });
  return { promise, reject, resolve };
}

function missingServerRuntime(): V2Runtime {
  const connection = new ObservableResource<SavedServerConnection | null>(null);
  const servers = new ObservableResource<SavedServer[]>([]);
  const statuses = new ObservableResource(new Map());
  connection.publish({ status: "ready", value: null });
  servers.publish({ status: "ready", value: [] });
  statuses.publish({ status: "ready", value: new Map() });
  return {
    connectionStatuses: statuses,
    savedServerConnection: () => connection,
    savedServers: servers,
  } as unknown as V2Runtime;
}
