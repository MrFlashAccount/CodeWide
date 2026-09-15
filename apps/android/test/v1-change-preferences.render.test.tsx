import { act, renderHook } from "@testing-library/react-native";
import { useChangesPreferences } from "../src/features/changes/changePresentation";

it("retains each qualified conversation's changes mode without transferring another conversation's preferences", () => {
  const hook = renderHook(({ scope }) => useChangesPreferences(scope), { initialProps: { scope: "changes-first" } });
  const update = hook.result.current.setChangesPreferences;
  act(() => update({ scope: "lastTurn", mode: "split", wrapLines: true }));
  expect(hook.result.current.changesPreferences).toEqual({ scope: "lastTurn", mode: "split", wrapLines: true });
  hook.rerender({ scope: "changes-second" });
  expect(hook.result.current.changesPreferences).toEqual({ scope: null, mode: "unified", wrapLines: false });
  expect(hook.result.current.setChangesPreferences).toBe(update);
  act(() => update({ scope: "session", mode: "source", wrapLines: false }));
  hook.rerender({ scope: "changes-first" });
  expect(hook.result.current.changesPreferences).toEqual({ scope: "lastTurn", mode: "split", wrapLines: true });
  hook.rerender({ scope: "changes-second" });
  expect(hook.result.current.changesPreferences).toEqual({ scope: "session", mode: "source", wrapLines: false });
});
