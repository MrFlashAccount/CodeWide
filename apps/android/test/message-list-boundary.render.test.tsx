import { describe, expect, it, jest } from "@jest/globals";
import { fireEvent, render } from "@testing-library/react-native";
import { useEffect, useState } from "react";
import { Pressable, Text, TextInput, View } from "react-native";

import { MessageListBoundary, type MessageListState } from "../src/ui/MessageListBoundary";

interface ScreenProps {
  state: MessageListState;
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
      <Pressable accessibilityLabel="Pin" onPress={props.pin}><Text>Pin</Text></Pressable>
      <MessageListBoundary state={props.state}><Text>Loaded response</Text></MessageListBoundary>
      <TextInput accessibilityLabel="Message" value={draft} onChangeText={setDraft} />
      <Pressable accessibilityLabel="Attach" onPress={props.attach}><Text>Attach</Text></Pressable>
    </View>
  );
}

describe("transcript-only loading", () => {
  it("keeps editing and actions available through loading, content, and failure", () => {
    const mounted = jest.fn();
    const attach = jest.fn();
    const pin = jest.fn();
    const view = render(<Screen state={{ status: "loading" }} mounted={mounted} attach={attach} pin={pin} />);
    expect(view.getByTestId("message-list-skeleton")).toBeTruthy();
    expect(view.queryByText("Loaded response")).toBeNull();
    fireEvent.changeText(view.getByLabelText("Message"), "Draft while waiting");
    fireEvent.press(view.getByLabelText("Attach"));
    fireEvent.press(view.getByLabelText("Pin"));
    expect(attach).toHaveBeenCalledTimes(1);
    expect(pin).toHaveBeenCalledTimes(1);
    view.rerender(<Screen state={{ status: "ready" }} mounted={mounted} attach={attach} pin={pin} />);
    expect(view.queryByTestId("message-list-skeleton")).toBeNull();
    expect(view.getByText("Loaded response")).toBeTruthy();
    expect(view.getByDisplayValue("Draft while waiting")).toBeTruthy();
    view.rerender(<Screen state={{ status: "error", message: "History unavailable", retry: async () => undefined }} mounted={mounted} attach={attach} pin={pin} />);
    expect(view.getByText("History unavailable")).toBeTruthy();
    expect(view.getByDisplayValue("Draft while waiting")).toBeTruthy();
    expect(mounted).toHaveBeenCalledTimes(1);
  });
});
