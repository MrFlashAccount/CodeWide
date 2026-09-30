import { fireEvent, render, screen } from "@testing-library/react-native";

import { ThreadErrorBanner } from "../src/ui/ThreadErrorBanner";

describe("ThreadErrorBanner", () => {
  it("shows a non-blocking error and permits selecting the full details", () => {
    render(<ThreadErrorBanner kind="generic" message="Request rejected by server" acceptsInput />);
    expect(screen.getByRole("alert")).toHaveTextContent("Response failed");
    expect(screen.getByText("You can send a new message.")).toBeVisible();
    fireEvent.press(screen.getByRole("button", { name: "Details" }));
    expect(screen.getByText("Request rejected by server")).toHaveProp("selectable", true);
    fireEvent.press(screen.getByRole("button", { name: "Hide details" }));
    expect(screen.getByRole("button", { name: "Details" })).toBeVisible();
  });

  it("does not promise direct input without server authority or offer automatic retry", () => {
    render(<ThreadErrorBanner kind="generic" message="Response failed" acceptsInput={false} />);
    expect(screen.queryByText("You can send a new message.")).toBeNull();
    expect(screen.getByText("This message was not automatically retried.")).toBeVisible();
    expect(screen.queryByRole("button", { name: /retry/i })).toBeNull();
  });

  it("explains that another app owns the conversation", () => {
    render(
      <ThreadErrorBanner
        acceptsInput={false}
        kind="conversationOpenElsewhere"
        message="This conversation is open in another app. Close it there, then try again here."
      />,
    );
    expect(screen.getByRole("alert")).toHaveTextContent("Conversation open elsewhere");
    expect(screen.getByText("Your message wasn’t sent.")).toBeVisible();
  });
});
