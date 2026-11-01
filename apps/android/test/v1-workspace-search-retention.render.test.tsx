import { act, renderHook } from "@testing-library/react-native";

import { useWorkspaceSearchSessionRetention } from "../src/routeComposition/useWorkspaceSearchSessionRetention";
import { disposeAllRouteSessions, ROUTE_SESSION_TTL_MS } from "../src/services/routeSessionPolicy";
import { searchRouteSessions } from "../src/services/search/searchRouteSession";
import { workspaceRouteSessionOwner } from "../src/services/threads/threadRouteParams";
import { resetMockRouter, router } from "./mocks/ExpoRouter";

afterEach(() => {
  disposeAllRouteSessions();
  resetMockRouter();
  jest.useRealTimers();
});

it("retains Search through tab blur and releases it on close and workspace teardown", () => {
  jest.useFakeTimers();
  jest.setSystemTime(0);
  const retained = searchRouteSessions.open(workspaceRouteSessionOwner);
  resetMockRouter({
    params: { globalSearchSessionId: retained.id },
    pathname: "/search",
  });
  const retention = renderHook(useWorkspaceSearchSessionRetention);

  act(() => router.navigate("/pulls"));
  act(() => jest.advanceTimersByTime(ROUTE_SESSION_TTL_MS + 1));
  expect(searchRouteSessions.get(retained.id, workspaceRouteSessionOwner)).not.toBeNull();

  act(() => {
    router.replace("/");
    searchRouteSessions.close(retained.id);
  });
  expect(searchRouteSessions.get(retained.id, workspaceRouteSessionOwner)).toBeNull();

  const tornDown = searchRouteSessions.open(workspaceRouteSessionOwner);
  act(() =>
    router.navigate({
      params: { globalSearchSessionId: tornDown.id },
      pathname: "/search",
    }),
  );
  act(() => router.navigate("/pulls"));
  expect(searchRouteSessions.get(tornDown.id, workspaceRouteSessionOwner)).not.toBeNull();

  act(() => disposeAllRouteSessions());
  expect(searchRouteSessions.get(tornDown.id, workspaceRouteSessionOwner)).toBeNull();
  retention.unmount();
});
