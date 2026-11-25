import { act, fireEvent, render, renderHook } from "@testing-library/react-native";
import { startTransition, Suspense, use, useLayoutEffect, useState } from "react";
import { Text } from "react-native";

import { useEvent } from "../src/react/useEvent";
import { useLatest } from "../src/react/useLatest";

it("rejects dispatch during both initial and subsequent renders before invoking the handler", () => {
  const handler = jest.fn();
  const hook = renderHook(
    (revision: number) => {
      const dispatch = useEvent(handler);
      expect(dispatch).toThrow(/during render/i);
      return revision;
    },
    { initialProps: 1 },
  );
  hook.rerender(2);
  expect(hook.result.current).toBe(2);
  expect(handler).not.toHaveBeenCalled();
});

it("keeps one callable as optional implementations change", () => {
  type Callback = (left: number, right: number) => number;
  const hook = renderHook((callback: Callback | false | null | undefined) => useEvent(callback), {
    initialProps: (left: number, right: number) => left + right,
  });
  const dispatch = hook.result.current;
  expect(dispatch(2, 3)).toBe(5);
  for (const absent of [false, null, undefined] as const) {
    hook.rerender(absent);
    expect(hook.result.current).toBe(dispatch);
    expect(dispatch(2, 3)).toBeUndefined();
  }
  hook.rerender((left, right) => left * right);
  expect(hook.result.current).toBe(dispatch);
  expect(dispatch(2, 3)).toBe(6);
});

it("guards an indirect call from a child render and allows the same callback on press", () => {
  const handler = jest.fn();
  function Child({ run }: { readonly run: () => void }) {
    expect(run).toThrow(/during render/i);
    return <Text onPress={run}>Run</Text>;
  }
  function Parent() {
    const dispatch = useEvent(handler);
    return <Child run={() => dispatch()} />;
  }
  const view = render(<Parent />);
  expect(handler).not.toHaveBeenCalled();
  fireEvent.press(view.getByText("Run"));
  expect(handler).toHaveBeenCalledTimes(1);
});

it("lets a child's layout effect call the newly committed implementation", () => {
  const observed = jest.fn();
  function Child({ revision, notify }: { readonly revision: number; readonly notify: () => void }) {
    useLayoutEffect(() => {
      notify();
    }, [revision, notify]);
    return null;
  }
  function Parent({ revision }: { readonly revision: number }) {
    const notify = useEvent(() => observed(revision));
    return <Child revision={revision} notify={notify} />;
  }
  const view = render(<Parent revision={1} />);
  view.rerender(<Parent revision={2} />);
  expect(observed.mock.calls).toEqual([[1], [2]]);
});

it("a press sees only the committed thread while the next thread is suspended", async () => {
  const pending = Promise.withResolvers<void>();
  const pressed = jest.fn();
  const attempted = jest.fn();

  function Thread({ id }: { readonly id: string }) {
    const latest = useLatest(id);
    const onPress = useEvent(() => pressed(id, latest.current));
    if (id === "next") {
      attempted();
      use(pending.promise);
    }
    return <Text onPress={onPress}>{id}</Text>;
  }

  function Screen() {
    const [id, setId] = useState("current");
    return (
      <Suspense fallback={<Text>Loading</Text>}>
        <Text onPress={() => startTransition(() => setId("next"))}>Open next</Text>
        <Thread id={id} />
      </Suspense>
    );
  }

  const view = render(<Screen />);
  await act(async () => {
    fireEvent.press(view.getByText("Open next"));
  });
  expect(attempted).toHaveBeenCalled();
  fireEvent.press(view.getByText("current"));
  expect(pressed).toHaveBeenLastCalledWith("current", "current");
  await act(async () => {
    pending.resolve();
    await pending.promise;
  });
  fireEvent.press(view.getByText("next"));
  expect(pressed).toHaveBeenLastCalledWith("next", "next");
});
