import { observable } from "@legendapp/state";
import type { LegendListRef } from "@legendapp/list/react-native";
import { act, fireEvent, render, renderHook } from "@testing-library/react-native";
import type { ReactNode } from "react";
import { StyleSheet } from "react-native";
import { makeMutable } from "react-native-reanimated";

import { NewThreadFloatingButton } from "../src/features/projects/NewThreadFloatingButton";
import type { GlobalVoiceControl } from "../src/features/threadList/GlobalVoiceEntryAction";
import { ThreadListFabStack } from "../src/features/threadList/ThreadListFabs";
import {
  ThreadListFabContext,
  type ThreadListFabModel,
} from "../src/features/threadList/threadListFabModel";
import { useThreadListFabScroll } from "../src/features/threadList/useThreadListFabScroll";

function fabModel(shown: boolean): ThreadListFabModel {
  return {
    shown$: observable(shown),
    visibility: makeMutable({ anchor: shown ? 0 : 400, shown }),
  };
}

function voice(state: GlobalVoiceControl["state"], onToggle = jest.fn()): GlobalVoiceControl {
  return { onToggle, orbState: state === "idle" ? "idle" : "connecting", state };
}

function FabStack({
  globalVoice,
  model,
  onNewThread = jest.fn(),
}: {
  readonly globalVoice: GlobalVoiceControl | null;
  readonly model: ThreadListFabModel;
  readonly onNewThread?: () => void;
}): ReactNode {
  return (
    <ThreadListFabContext.Provider value={model}>
      <ThreadListFabStack
        globalVoice={globalVoice}
        newThread={{ onPress: onNewThread, projectName: null }}
      />
    </ThreadListFabContext.Provider>
  );
}

function flatStyle(node: ReturnType<ReturnType<typeof render>["getByTestId"]>) {
  return StyleSheet.flatten(node.props.style);
}

it("renders New thread as a circle", () => {
  const view = render(<NewThreadFloatingButton onPress={jest.fn()} projectName={null} />);
  const style = flatStyle(view.getByTestId("new-thread-fab"));
  expect(style.width).toBe(style.height);
  expect(style.borderRadius).toBe(Number(style.width) / 2);
});

it("stacks the smaller voice action directly above New thread on the same axis", () => {
  const view = render(<FabStack globalVoice={voice("idle")} model={fabModel(true)} />);
  const primary = flatStyle(view.getByTestId("new-thread-fab-slot"));
  const secondary = flatStyle(view.getByTestId("global-voice-fab-slot"));
  const primaryButton = flatStyle(view.getByTestId("new-thread-fab"));
  const secondaryButton = flatStyle(view.getByTestId("global-voice-slot"));
  const primarySize = Number(primaryButton.width);
  const secondarySize = Number(secondaryButton.width);

  expect(secondarySize).toBeLessThan(primarySize);
  expect(Number(secondary.bottom)).toBeGreaterThan(Number(primary.bottom) + primarySize);
  expect(Number(secondary.right) + secondarySize / 2).toBe(Number(primary.right) + primarySize / 2);
  expect(view.getByLabelText("Start Global Voice Mode")).toBeTruthy();
  expect(view.getByLabelText("New thread")).toBeTruthy();
});

it("keeps the voice action's labels and native handoff semantics", () => {
  const onToggle = jest.fn();
  const model = fabModel(true);
  const view = render(<FabStack globalVoice={voice("idle", onToggle)} model={model} />);
  const idle = view.getByLabelText("Start Global Voice Mode");
  expect(idle.props.accessibilityState).toMatchObject({ disabled: false, selected: false });
  expect(view.getByTestId("global-voice-orb", { includeHiddenElements: true }).props.orbState).toBe(
    "disabled",
  );

  view.rerender(<FabStack globalVoice={voice("starting", onToggle)} model={model} />);
  // Android hands the orb to the floating overlay; its measured anchor stays mounted.
  expect(view.queryByLabelText("Starting Global Voice Mode")).toBeNull();
  expect(view.queryByTestId("global-voice-orb", { includeHiddenElements: true })).toBeNull();
  expect(view.getByTestId("global-voice-orb-anchor", { includeHiddenElements: true })).toBeTruthy();
});

it("shows only New thread when the voice control is unavailable", () => {
  const view = render(<FabStack globalVoice={null} model={fabModel(true)} />);
  expect(view.getByLabelText("New thread")).toBeTruthy();
  expect(view.queryByTestId("global-voice-fab-slot", { includeHiddenElements: true })).toBeNull();
  expect(view.queryByTestId("global-voice-slot", { includeHiddenElements: true })).toBeNull();
});

it("moves the voice action into the New thread slot when the scope has no New thread", () => {
  const model = fabModel(true);
  const view = render(
    <ThreadListFabContext.Provider value={model}>
      <ThreadListFabStack globalVoice={voice("idle")} newThread={null} />
    </ThreadListFabContext.Provider>,
  );
  expect(view.queryByTestId("new-thread-fab-slot", { includeHiddenElements: true })).toBeNull();
  const alone = flatStyle(view.getByTestId("global-voice-fab-slot"));
  const above = flatStyle(
    render(<FabStack globalVoice={voice("idle")} model={model} />).getByTestId(
      "global-voice-fab-slot",
    ),
  );
  expect(Number(alone.bottom)).toBeLessThan(Number(above.bottom));
  expect(alone.right).toBe(above.right);
});

it("removes scroll-hidden actions from touch and accessibility until they show again", () => {
  const onNewThread = jest.fn();
  const model = fabModel(false);
  const view = render(
    <FabStack globalVoice={voice("idle")} model={model} onNewThread={onNewThread} />,
  );
  for (const testID of ["new-thread-fab-slot", "global-voice-fab-slot"]) {
    const slot = view.getByTestId(testID, { includeHiddenElements: true });
    expect(slot.props.pointerEvents).toBe("none");
    expect(slot.props.accessibilityElementsHidden).toBe(true);
    expect(slot.props.importantForAccessibility).toBe("no-hide-descendants");
    expect(flatStyle(slot).opacity).toBe(0);
  }
  expect(view.queryByLabelText("New thread")).toBeNull();
  expect(view.queryByLabelText("Start Global Voice Mode")).toBeNull();
  fireEvent.press(view.getByLabelText("New thread", { includeHiddenElements: true }));
  expect(onNewThread).not.toHaveBeenCalled();

  act(() => {
    model.visibility.set({ anchor: 0, shown: true });
    model.shown$.set(true);
  });
  for (const testID of ["new-thread-fab-slot", "global-voice-fab-slot"]) {
    const slot = view.getByTestId(testID);
    expect(slot.props.pointerEvents).toBe("box-none");
    expect(slot.props.accessibilityElementsHidden).toBe(false);
    expect(flatStyle(slot).opacity).toBe(1);
  }
  expect(view.getByLabelText("Start Global Voice Mode")).toBeTruthy();
  fireEvent.press(view.getByLabelText("New thread"));
  expect(onNewThread).toHaveBeenCalledTimes(1);
});

it("keeps the voice anchor shown during a session while New thread follows scroll", () => {
  const view = render(<FabStack globalVoice={voice("active")} model={fabModel(false)} />);
  expect(view.getByTestId("global-voice-fab-slot").props.pointerEvents).toBe("box-none");
  expect(
    view.getByTestId("new-thread-fab-slot", { includeHiddenElements: true }).props.pointerEvents,
  ).toBe("none");
});

it("shows the actions when a list scope attaches and when it detaches", () => {
  const model = fabModel(false);
  const { result } = renderHook(() => useThreadListFabScroll(model));
  // WHY: Without Reanimated's native runtime the attachment reads no scroll view from the list.
  // oxlint-disable-next-line typescript/no-unsafe-type-assertion
  const list = {} as LegendListRef;
  let detach: (() => void) | undefined;
  act(() => {
    detach = result.current(list);
  });
  expect(model.shown$.get()).toBe(true);
  expect(model.visibility.get().shown).toBe(true);

  act(() => {
    model.shown$.set(false);
    model.visibility.set({ anchor: 400, shown: false });
    detach?.();
  });
  expect(model.shown$.get()).toBe(true);
  expect(model.visibility.get().shown).toBe(true);
});
