import { act, renderHook } from "@testing-library/react-native";
import { useChangesPreferences } from "../src/features/changes/changePresentation";

it("retains each qualified conversation's changes mode without transferring another conversation's preferences", () => {
  const hook = renderHook(({ scope }) => useChangesPreferences(scope), { initialProps: { scope: "changes-first" } });
  const update = hook.result.current.setChangesPreferences;
  act(() => update({ scope: "uncommitted", mode: "split", wrapLines: true }));
  expect(hook.result.current.changesPreferences).toEqual({ scope: "uncommitted", mode: "split", wrapLines: true });
  hook.rerender({ scope: "changes-second" });
  expect(hook.result.current.changesPreferences).toEqual({ scope: null, mode: "unified", wrapLines: false });
  expect(hook.result.current.setChangesPreferences).toBe(update);
  act(() => update({ scope: "session", mode: "source", wrapLines: false }));
  hook.rerender({ scope: "changes-first" });
  expect(hook.result.current.changesPreferences).toEqual({ scope: "uncommitted", mode: "split", wrapLines: true });
  hook.rerender({ scope: "changes-second" });
  expect(hook.result.current.changesPreferences).toEqual({ scope: "session", mode: "source", wrapLines: false });
});

it("drops a legacy scope from current Changes preferences", () => {
  const hook = renderHook(() => useChangesPreferences("changes-legacy-scope"));
  act(() => hook.result.current.setChangesPreferences({ scope: "lastTurn", mode: "split", wrapLines: true }));
  expect(hook.result.current.changesPreferences).toEqual({ scope: null, mode: "split", wrapLines: true });
});
