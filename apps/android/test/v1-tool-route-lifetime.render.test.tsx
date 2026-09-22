import { act, renderHook } from "@testing-library/react-native";

import { useThreadToolRouteSession } from "../src/routeComposition/threadToolRouteSession";
import { composerToolRouteSessions } from "../src/services/composer/composerToolRouteSession";
import { disposeAllRouteSessions } from "../src/services/routeSessionPolicy";
import {
  threadRouteSessionOwner,
  v1ThreadRouteParams,
} from "../src/services/threads/threadRouteParams";
import { resetMockRouter, router } from "./mocks/ExpoRouter";

afterEach(() => {
  disposeAllRouteSessions();
  resetMockRouter();
  jest.restoreAllMocks();
});

it("keeps the ports route session available until Router removes its screen", () => {
  const parsed = v1ThreadRouteParams({ connectionId: "server", threadId: "thread" });
  if (parsed.status === "invalid") {
    throw new Error("Expected valid test thread route");
  }
  const owner = threadRouteSessionOwner(parsed.value);
  const session = composerToolRouteSessions.open(owner, {
    connectionId: null,
    kind: "ports",
    resources: null,
    serverName: "Server",
    tunnelResourceId: null,
  });
  resetMockRouter({
    params: { connectionId: "server", threadId: "thread" },
    pathname: "/threads/[connectionId]/[threadId]",
  });
  router.push({
    params: { connectionId: "server", sessionId: session.id, threadId: "thread" },
    pathname: "/threads/[connectionId]/[threadId]/ports",
  });
  const back = jest.spyOn(router, "back").mockImplementation(() => undefined);
  const route = renderHook(useThreadToolRouteSession);

  expect(route.result.current.status).toBe("available");
  act(() => {
    route.result.current.recover();
  });

  expect(back).toHaveBeenCalledTimes(1);
  expect(composerToolRouteSessions.get(session.id, owner)).toBe(session);

  route.unmount();
  expect(composerToolRouteSessions.get(session.id, owner)).toBeNull();
});
