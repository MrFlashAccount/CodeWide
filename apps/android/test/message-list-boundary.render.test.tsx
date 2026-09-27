import { afterEach, beforeEach, describe, expect, it, jest } from "@jest/globals";
import { act, cleanup, fireEvent, render } from "@testing-library/react-native";
import { useEffect, useState } from "react";
import { Pressable, Text, TextInput, View } from "react-native";

import {
  MessageListBoundary,
  type MessageListPresentationState,
} from "../src/ui/MessageListBoundary";

interface ScreenProps {
  state: MessageListPresentationState;
  scope?: string;
  mounted(): void;
  attach(): void;
  pin(): void;
}

function Screen(props: ScreenProps) {
  const [draft, setDraft] = useState("");
  useEffect(props.mounted, [props.mounted]);
  return (
    <View>
      <Text>Session header</Text>
      <Pressable accessibilityLabel="Pin" onPress={props.pin}>
        <Text>Pin</Text>
      </Pressable>
      <MessageListBoundary
        contentInsets={{ top: 64, bottom: 112 }}
        loadingKey={props.scope ?? "chat-a"}
        state={props.state}
      >
        <Text>Loaded response</Text>
      </MessageListBoundary>
      <TextInput accessibilityLabel="Message" value={draft} onChangeText={setDraft} />
      <Pressable accessibilityLabel="Attach" onPress={props.attach}>
        <Text>Attach</Text>
      </Pressable>
    </View>
  );
}

describe("transcript-only loading", () => {
  beforeEach(() => jest.useFakeTimers());
  afterEach(() => {
    cleanup();
    jest.useRealTimers();
  });

  it("keeps editing and actions available through loading, content, and failure", () => {
    const mounted = jest.fn();
    const attach = jest.fn();
    const pin = jest.fn();
    const view = render(
      <Screen state={{ status: "loading" }} mounted={mounted} attach={attach} pin={pin} />,
    );
    expect(view.queryByTestId("message-list-skeleton")).toBeNull();
    expect(view.queryByText("Loaded response")).toBeNull();
    fireEvent.changeText(view.getByLabelText("Message"), "Draft while waiting");
    fireEvent.press(view.getByLabelText("Attach"));
    fireEvent.press(view.getByLabelText("Pin"));
    expect(attach).toHaveBeenCalledTimes(1);
    expect(pin).toHaveBeenCalledTimes(1);
    act(() => jest.advanceTimersByTime(199));
    expect(view.queryByTestId("message-list-skeleton")).toBeNull();
    act(() => jest.advanceTimersByTime(1));
    expect(view.getByTestId("message-list-skeleton")).toBeVisible();
    view.rerender(
      <Screen state={{ status: "ready" }} mounted={mounted} attach={attach} pin={pin} />,
    );
    expect(view.queryByTestId("message-list-skeleton")).toBeNull();
    expect(view.getByText("Loaded response", { includeHiddenElements: true })).toBeTruthy();
    expect(view.getByDisplayValue("Draft while waiting")).toBeTruthy();
    view.rerender(
      <Screen
        state={{ status: "error", message: "History unavailable", retry: async () => undefined }}
        mounted={mounted}
        attach={attach}
        pin={pin}
      />,
    );
    expect(view.getByText("History unavailable")).toBeTruthy();
    expect(view.getByDisplayValue("Draft while waiting")).toBeTruthy();
    expect(mounted).toHaveBeenCalledTimes(1);
  });

  it.each([0, 40, 199])("never flashes a skeleton when messages arrive after %i ms", (elapsed) => {
    const props = { mounted: jest.fn(), attach: jest.fn(), pin: jest.fn() };
    const view = render(<Screen {...props} state={{ status: "loading" }} />);
    expect(view.queryByTestId("message-list-skeleton")).toBeNull();

    act(() => jest.advanceTimersByTime(elapsed));
    view.rerender(<Screen {...props} state={{ status: "ready" }} />);

    expect(view.getByText("Loaded response")).toBeVisible();
    expect(view.queryByTestId("message-list-skeleton")).toBeNull();
    act(() => jest.advanceTimersByTime(500));
    expect(view.getByText("Loaded response")).toBeVisible();
    expect(view.queryByTestId("message-list-skeleton")).toBeNull();
  });

  it("reveals a list positioned in 7 ms without ever showing its skeleton", () => {
    const props = { mounted: jest.fn(), attach: jest.fn(), pin: jest.fn() };
    const view = render(<Screen {...props} state={{ status: "positioning" }} />);

    expect(view.getByText("Loaded response", { includeHiddenElements: true })).not.toBeVisible();
    expect(view.queryByTestId("message-list-skeleton")).toBeNull();
    act(() => jest.advanceTimersByTime(7));
    view.rerender(<Screen {...props} state={{ status: "ready" }} />);

    expect(view.getByText("Loaded response")).toBeVisible();
    expect(view.queryByTestId("message-list-skeleton")).toBeNull();
    act(() => jest.advanceTimersByTime(500));
    expect(view.queryByTestId("message-list-skeleton")).toBeNull();
  });

  it("keeps a slow list hidden and shows its skeleton only after 200 ms", () => {
    const props = { mounted: jest.fn(), attach: jest.fn(), pin: jest.fn() };
    const view = render(<Screen {...props} state={{ status: "positioning" }} />);

    act(() => jest.advanceTimersByTime(199));
    expect(view.queryByTestId("message-list-skeleton")).toBeNull();
    expect(view.getByText("Loaded response", { includeHiddenElements: true })).not.toBeVisible();
    act(() => jest.advanceTimersByTime(1));
    expect(view.getByTestId("message-list-skeleton")).toBeVisible();

    view.rerender(<Screen {...props} state={{ status: "ready" }} />);
    expect(view.getByText("Loaded response")).toBeVisible();
    expect(view.queryByTestId("message-list-skeleton")).toBeNull();
  });

  it("shows cached messages immediately without scheduling a placeholder", () => {
    const view = render(
      <Screen state={{ status: "ready" }} mounted={jest.fn()} attach={jest.fn()} pin={jest.fn()} />,
    );
    expect(view.getByText("Loaded response")).toBeVisible();
    expect(view.queryByTestId("message-list-skeleton")).toBeNull();
    expect(jest.getTimerCount()).toBe(0);
  });

  it.each([150, 250])("gives a new chat its own delay when leaving after %i ms", (elapsed) => {
    const props = { mounted: jest.fn(), attach: jest.fn(), pin: jest.fn() };
    const view = render(<Screen {...props} scope="chat-a" state={{ status: "loading" }} />);
    act(() => jest.advanceTimersByTime(elapsed));

    view.rerender(<Screen {...props} scope="chat-b" state={{ status: "loading" }} />);
    expect(view.queryByTestId("message-list-skeleton")).toBeNull();
    act(() => jest.advanceTimersByTime(199));
    expect(view.queryByTestId("message-list-skeleton")).toBeNull();
    act(() => jest.advanceTimersByTime(1));
    expect(view.getByTestId("message-list-skeleton")).toBeVisible();
    expect(props.mounted).toHaveBeenCalledTimes(1);
  });

  it("does not restart the delay when the same loading chat rerenders", () => {
    const props = { mounted: jest.fn(), attach: jest.fn(), pin: jest.fn() };
    const view = render(<Screen {...props} state={{ status: "loading" }} />);
    act(() => jest.advanceTimersByTime(150));
    fireEvent.changeText(view.getByLabelText("Message"), "The draft changed");
    act(() => jest.advanceTimersByTime(50));
    expect(view.getByTestId("message-list-skeleton")).toBeVisible();
    expect(view.getByDisplayValue("The draft changed")).toBeTruthy();
  });

  it("shows errors immediately and gives a retry a fresh delay", () => {
    const props = { mounted: jest.fn(), attach: jest.fn(), pin: jest.fn() };
    const view = render(<Screen {...props} state={{ status: "loading" }} />);
    act(() => jest.advanceTimersByTime(40));
    view.rerender(
      <Screen
        {...props}
        state={{ status: "error", message: "History unavailable", retry: async () => undefined }}
      />,
    );
    expect(view.getByRole("alert")).toHaveTextContent("History unavailable");
    act(() => jest.advanceTimersByTime(500));
    expect(view.queryByTestId("message-list-skeleton")).toBeNull();

    view.rerender(<Screen {...props} state={{ status: "loading" }} />);
    act(() => jest.advanceTimersByTime(199));
    expect(view.queryByTestId("message-list-skeleton")).toBeNull();
    act(() => jest.advanceTimersByTime(1));
    expect(view.getByTestId("message-list-skeleton")).toBeVisible();
  });

  it("cancels the appearance timer on departure", () => {
    const view = render(
      <Screen
        state={{ status: "loading" }}
        mounted={jest.fn()}
        attach={jest.fn()}
        pin={jest.fn()}
      />,
    );
    act(() => jest.advanceTimersByTime(40));
    view.unmount();
    expect(jest.getTimerCount()).toBe(0);
  });
});
