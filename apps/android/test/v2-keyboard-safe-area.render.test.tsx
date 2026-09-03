import { describe, expect, it, jest } from "@jest/globals";
import { act, fireEvent, render, screen, within } from "@testing-library/react-native";
import { SafeAreaInsetsContext } from "react-native-safe-area-context";

import { ChatComposer } from "../src/v2/features/composer/ChatComposer";
import { ConversationComposerDockView } from "../src/v2/presentation/conversation/ConversationComposerDockView";

describe("V2 keyboard-aware composer dock", () => {
  it("keeps the interactive composer inside a dock offset by the current bottom inset", async () => {
    const onSubmit = jest.fn(async () => true);
    render(
      <SafeAreaInsetsContext.Provider value={{ bottom: 32, left: 0, right: 0, top: 0 }}>
        <ConversationComposerDockView>
          <ChatComposer disabled={false} error={null} onSubmit={onSubmit} />
        </ConversationComposerDockView>
      </SafeAreaInsetsContext.Provider>,
    );

    const dock = screen.getByTestId("keyboard-sticky-view");
    expect(dock.props.enabled).toBe(true);
    expect(dock.props.offset).toEqual({ closed: 0, opened: 32 });

    const composer = within(dock).getByLabelText("Message Codex");
    fireEvent.changeText(composer, "Keep this above the keyboard");
    await act(async () => {
      fireEvent.press(within(dock).getByLabelText("Send message"));
      await Promise.resolve();
    });
    expect(onSubmit).toHaveBeenCalledWith("Keep this above the keyboard");
  });
});
