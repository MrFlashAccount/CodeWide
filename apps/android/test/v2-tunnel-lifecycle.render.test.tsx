import { act, renderHook } from "@testing-library/react-native";

import { useTunnelLifecycle } from "../src/v2/infrastructure/react/useTunnelLifecycle";

describe("V2 bounded tunnel lifecycle", () => {
  beforeEach(() => jest.useFakeTimers());
  afterEach(() => jest.useRealTimers());

  it("expires and revokes the tunnel exactly once", () => {
    const onDispose = jest.fn();
    const onExpire = jest.fn();
    const rendered = renderHook(() =>
      useTunnelLifecycle({
        expiresAt: 1_500,
        now: () => 1_000,
        onDispose,
        onExpire,
        tunnelId: "tunnel-1",
      }),
    );

    act(() => jest.advanceTimersByTime(500));
    expect(onExpire).toHaveBeenCalledTimes(1);
    expect(onDispose).toHaveBeenCalledWith("tunnel-1");

    rendered.unmount();
    expect(onDispose).toHaveBeenCalledTimes(1);
  });

  it("revokes a live tunnel when the route unmounts", () => {
    const onDispose = jest.fn();
    const rendered = renderHook(() =>
      useTunnelLifecycle({
        expiresAt: 5_000,
        now: () => 1_000,
        onDispose,
        onExpire: jest.fn(),
        tunnelId: "tunnel-2",
      }),
    );

    rendered.unmount();
    expect(onDispose).toHaveBeenCalledTimes(1);
    expect(onDispose).toHaveBeenCalledWith("tunnel-2");
  });

  it("revokes the previous tunnel when reconnect replaces the session", () => {
    const onDispose = jest.fn();
    const onExpire = jest.fn();
    const rendered = renderHook(
      (props) => useTunnelLifecycle(props),
      {
        initialProps: {
          expiresAt: 5_000,
          now: () => 1_000,
          onDispose,
          onExpire,
          tunnelId: "tunnel-before-reconnect",
        },
      },
    );

    rendered.rerender({
      expiresAt: 8_000,
      now: () => 1_000,
      onDispose,
      onExpire,
      tunnelId: "tunnel-after-reconnect",
    });
    expect(onDispose).toHaveBeenCalledTimes(1);
    expect(onDispose).toHaveBeenCalledWith("tunnel-before-reconnect");

    rendered.unmount();
    expect(onDispose).toHaveBeenCalledTimes(2);
    expect(onDispose).toHaveBeenLastCalledWith("tunnel-after-reconnect");
  });
});
