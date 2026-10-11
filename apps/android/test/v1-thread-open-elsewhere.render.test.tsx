import { render, screen } from "@testing-library/react-native";
import { View } from "react-native";

import { ConversationBottomChrome } from "../src/features/conversation/ConversationBottomChrome";
import { createV1TestThread } from "./fixtures/v1Thread";

const openElsewhereFailure = {
  acceptsInput: false,
  kind: "conversationOpenElsewhere" as const,
  message: "This conversation is open in another app. Close it there, then try again here.",
};

function chrome(canAcceptDirectInput: boolean | null) {
  const thread = { ...createV1TestThread("thread", null, 1, []), canAcceptDirectInput };
  return (
    <ConversationBottomChrome
      composerContent={<View testID="composer" />}
      currentOutcome={null}
      failureNotice={openElsewhereFailure}
      readOnly
      remoteThread={thread}
      reportBottomChromeHeight={jest.fn()}
      requestPrompt={null}
      timeline={[]}
    />
  );
}

describe("a conversation another app is running", () => {
  it("states the lock once instead of a send failure", () => {
    render(chrome(false));
    expect(screen.getByTestId("thread-open-elsewhere-notice")).toHaveTextContent(
      /Conversation open elsewhere.*send once it finishes/,
    );
    expect(screen.queryByTestId("thread-error-banner")).toBeNull();
  });

  it("is not claimed for a read-only thread whose input is merely unknown", () => {
    render(chrome(null));
    expect(screen.queryByTestId("thread-open-elsewhere-notice")).toBeNull();
    expect(screen.getByTestId("thread-error-banner")).toBeOnTheScreen();
  });
});
