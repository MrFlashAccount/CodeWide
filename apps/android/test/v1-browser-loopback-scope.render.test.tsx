import { act, renderHook } from "@testing-library/react-native";
import { useLoopbackNavigation } from "../src/features/ports/loopbackNavigation";
import { v1ThreadRouteParams } from "../src/services/threads/threadRouteParams";

const mockEnsureStarted = jest.fn();
jest.mock("../src/data/native-port-forwarding-store", () => ({ nativePortForwardingStore: { ensureStarted: (...args: unknown[]) => mockEnsureStarted(...args) } }));

it("opens a delayed forwarded link in its originating chat after the user selects another chat", async () => {
  const first = v1ThreadRouteParams({ connectionId: "server-a", threadId: "first" });
  const second = v1ThreadRouteParams({ connectionId: "server-b", threadId: "second" });
  if (first.status === "invalid" || second.status === "invalid") throw new Error("Bad fixture");
  const profile = { label: "localhost:3000", localPort: 43000 };
  let finish: (result: typeof profile) => void = () => { throw new Error("Forward not initialized"); };
  mockEnsureStarted.mockImplementation(() => new Promise<typeof profile>((resolve) => { finish = resolve; }));
  const openBrowser = jest.fn();
  const openBrowserInThread = jest.fn();
  const hook = renderHook(({ scope }) => useLoopbackNavigation(true, scope.connectionId.value, { openBrowser, openBrowserInThread, thread: scope }), { initialProps: { scope: first.value } });
  let pending: Promise<void> | undefined;
  act(() => { pending = hook.result.current?.({ protocol: "http:", remotePort: 3000, suffix: "/page?query=value" }); });
  hook.rerender({ scope: second.value });
  await act(async () => { finish(profile); await pending; });
  expect(mockEnsureStarted).toHaveBeenCalledWith({ connectionId: "server-a", label: "localhost:3000", remotePort: 3000 });
  expect(openBrowserInThread).toHaveBeenCalledWith("localhost:3000", "http://127.0.0.1:43000/page?query=value", first.value);
  expect(openBrowser).not.toHaveBeenCalled();
});
