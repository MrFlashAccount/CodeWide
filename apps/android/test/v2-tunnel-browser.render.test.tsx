import { act, fireEvent, render, screen } from "@testing-library/react-native";
import { router } from "expo-router";
import { Text } from "react-native";

import type { V2Runtime } from "../src/v2/application/v2Runtime";
import { V2RuntimeProvider } from "../src/v2/application/react/V2RuntimeContext";
import type { TunnelLifecycleProps } from "../src/v2/application/ports/tunnelLifecycle";
import { savedServerId } from "../src/v2/domain/ids";
import { TunnelBrowserScreen } from "../src/v2/features/ports/TunnelBrowserScreen";
import type { InternalBrowserContentProps } from "../src/v2/presentation/browser/InternalBrowserView";

describe("V2 bounded tunnel browser", () => {
  afterEach(() => jest.restoreAllMocks());

  it("guards revoke, announces the exact failure, and retries before closing", async () => {
    const first = deferred<void>();
    const second = deferred<void>();
    const deleteTunnel = jest
      .fn<() => Promise<void>>()
      .mockImplementationOnce(() => first.promise)
      .mockImplementationOnce(() => second.promise);
    // WHY: Constructing the production runtime would start platform services unavailable in Jest.
    const runtime = {
      now: () => 2_000,
      ports: () => ({ createTunnel: jest.fn(), deleteTunnel }),
    } as unknown as V2Runtime;
    const back = jest.spyOn(router, "back").mockImplementation(() => undefined);

    render(
      <V2RuntimeProvider runtime={runtime}>
        <TunnelBrowserScreen
          browser={Browser}
          initialSession={{
            expiresAt: 1_000,
            label: "localhost:3000",
            port: 3_000,
            sourcePath: "/v2/tunnels/tunnel-1/",
            suffix: "",
            tunnelId: "tunnel-1",
          }}
          lifecycle={Lifecycle}
          savedServerId={savedServerId("server-1")}
        />
      </V2RuntimeProvider>,
    );

    fireEvent.press(screen.getByLabelText("Close browser"));
    fireEvent.press(screen.getByLabelText("Close browser"));

    expect(deleteTunnel).toHaveBeenCalledTimes(1);
    expect(screen.getByLabelText("Close browser").props.accessibilityState).toEqual({
      busy: true,
      disabled: true,
    });
    expect(screen.getByText("Revoking bounded tunnel…")).toBeTruthy();
    expect(back).not.toHaveBeenCalled();

    await act(async () => {
      first.reject(new Error("Companion refused this tunnel revoke."));
      await first.promise.catch(() => undefined);
    });

    const error = screen.getByText("Companion refused this tunnel revoke.");
    expect(error.props.accessibilityLiveRegion).toBe("polite");
    expect(screen.getByLabelText("Retry revoke").props.accessibilityState).toEqual({
      busy: false,
      disabled: false,
    });

    fireEvent.press(screen.getByLabelText("Retry revoke"));
    fireEvent.press(screen.getByLabelText("Close browser"));
    expect(deleteTunnel).toHaveBeenCalledTimes(2);

    await act(async () => {
      second.resolve();
      await second.promise;
    });
    expect(back).toHaveBeenCalledTimes(1);
  });
});

function Browser(_props: InternalBrowserContentProps): React.JSX.Element {
  return <Text>Browser</Text>;
}

function Lifecycle(_props: TunnelLifecycleProps): null {
  return null;
}

interface Deferred<T> {
  promise: Promise<T>;
  reject(cause: unknown): void;
  resolve(value: T): void;
}

function deferred<T>(): Deferred<T> {
  let reject!: (cause: unknown) => void;
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((promiseResolve, promiseReject) => {
    resolve = promiseResolve;
    reject = promiseReject;
  });
  return { promise, reject, resolve };
}
