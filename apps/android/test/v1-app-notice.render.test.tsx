import { act, fireEvent, render } from "@testing-library/react-native";
import { GestureHandlerRootView } from "react-native-gesture-handler";

import { appNoticeStore } from "../src/ui/appNoticeStore";
import { AppNoticeViewport } from "../src/ui/AppNoticeViewport";

afterEach(() => appNoticeStore.clear());

it("keeps a narrow top toast actionable while rendering the notice stack", () => {
  const open = jest.fn();
  const view = render(
    <GestureHandlerRootView>
      <AppNoticeViewport />
    </GestureHandlerRootView>,
  );
  act(() => {
    appNoticeStore.show({
      actionLabel: "Open",
      description: "report.pdf",
      label: "File saved",
      onActionPress: open,
      variant: "success",
    });
  });

  expect(view.getByText("File saved")).toBeTruthy();
  expect(view.getByText("report.pdf")).toBeTruthy();
  expect(view.getByTestId("app-notice-stack")).toHaveStyle({ maxWidth: 440 });
  fireEvent.press(view.getByText("Open"), { stopPropagation: jest.fn() });
  expect(open).toHaveBeenCalledTimes(1);
  expect(view.queryByText("File saved")).toBeNull();
});

it("expands a tapped stack and keeps its notices available while expanded", () => {
  jest.useFakeTimers();
  try {
    const view = render(
      <GestureHandlerRootView>
        <AppNoticeViewport />
      </GestureHandlerRootView>,
    );
    act(() => {
      appNoticeStore.show({ label: "First notice" });
      appNoticeStore.show({ label: "Second notice" });
    });

    fireEvent.press(view.getByText("Second notice"));
    act(() => {
      jest.advanceTimersByTime(5000);
    });
    expect(view.getByText("First notice")).toBeTruthy();
    expect(view.getByText("Second notice")).toBeTruthy();

    fireEvent.press(view.getByText("Second notice"));
    act(() => {
      jest.advanceTimersByTime(5000);
    });
    expect(view.queryByText("First notice")).toBeNull();
    expect(view.queryByText("Second notice")).toBeNull();
  } finally {
    jest.useRealTimers();
  }
});
