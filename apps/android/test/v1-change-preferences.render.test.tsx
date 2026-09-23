import { act, renderHook } from "@testing-library/react-native";
import {
  selectChangePresentation,
  useChangesPreferences,
} from "../src/features/changes/changePresentation";
import type { ThreadResourcesValue } from "../src/data/workspace-resource-database";

it("retains each qualified conversation's changes mode without transferring another conversation's preferences", () => {
  const hook = renderHook(({ scope }) => useChangesPreferences(scope), {
    initialProps: { scope: "changes-first" },
  });
  const update = hook.result.current.setChangesPreferences;
  act(() => update({ scope: "uncommitted", mode: "split", wrapLines: true }));
  expect(hook.result.current.changesPreferences).toEqual({
    scope: "uncommitted",
    mode: "split",
    wrapLines: true,
  });
  hook.rerender({ scope: "changes-second" });
  expect(hook.result.current.changesPreferences).toEqual({
    scope: null,
    mode: "unified",
    wrapLines: false,
  });
  expect(hook.result.current.setChangesPreferences).toBe(update);
  act(() => update({ scope: "session", mode: "source", wrapLines: false }));
  hook.rerender({ scope: "changes-first" });
  expect(hook.result.current.changesPreferences).toEqual({
    scope: "uncommitted",
    mode: "split",
    wrapLines: true,
  });
  hook.rerender({ scope: "changes-second" });
  expect(hook.result.current.changesPreferences).toEqual({
    scope: "session",
    mode: "source",
    wrapLines: false,
  });
});

it("drops a legacy scope from current Changes preferences", () => {
  const hook = renderHook(() => useChangesPreferences("changes-legacy-scope"));
  act(() =>
    hook.result.current.setChangesPreferences({
      scope: "lastTurn",
      mode: "split",
      wrapLines: true,
    }),
  );
  expect(hook.result.current.changesPreferences).toEqual({
    scope: null,
    mode: "split",
    wrapLines: true,
  });
});

it("falls back to the available Changes scope before a route loads", () => {
  expect(selectChangePresentation(null, "uncommitted")).toEqual({
    resource: null,
    scope: "session",
    scopes: ["session"],
  });

  const arcResource: ThreadResourcesValue = {
    attachments: [],
    changeScope: "branch",
    changeScopes: ["session", "branch"],
    changes: [],
    revision: "arc-branch-r1",
    threadId: "thread",
  };
  expect(selectChangePresentation(arcResource, "uncommitted")).toEqual({
    resource: arcResource,
    scope: "branch",
    scopes: ["session", "branch"],
  });
});
