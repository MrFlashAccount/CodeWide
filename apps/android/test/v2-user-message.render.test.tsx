import { describe, expect, it } from "@jest/globals";
import { act, fireEvent, render, screen } from "@testing-library/react-native";

import { TimelineUserInputView } from "../src/v2/presentation/conversation/timelineUserInputView";

describe("V2 user message presentation", () => {
  it("collapses a large user message to 25 lines and expands it on demand", async () => {
    const text = Array.from({ length: 30 }, (_, index) => `Line ${String(index + 1)}`).join("\n");
    render(<TimelineUserInputView blocks={[{ kind: "text", text, textElements: [] }]} />);

    expect(screen.getByText(text).props.numberOfLines).toBe(25);
    expect(screen.getByLabelText("Show full message").props.accessibilityState.expanded).toBe(
      false,
    );

    await act(async () => fireEvent.press(screen.getByLabelText("Show full message")));

    expect(screen.getByLabelText("Collapse message").props.accessibilityState.expanded).toBe(true);
    expect(screen.getByText(text).props.numberOfLines).toBeUndefined();
  });

  it("does not add expansion controls to a short message", () => {
    render(
      <TimelineUserInputView
        blocks={[{ kind: "text", text: "Short message", textElements: [] }]}
      />,
    );

    expect(screen.getByText("Short message")).toBeTruthy();
    expect(screen.queryByLabelText("Show full message")).toBeNull();
  });

  it("renders the exact authoritative mention name instead of deriving one from its attachment", () => {
    render(
      <TimelineUserInputView
        blocks={[
          {
            attachment: {
              downloadUrl: "/v2/files/report",
              id: "report",
              mediaType: "text/markdown",
              name: "server-storage-name",
              sizeBytes: "42",
            },
            kind: "mention",
            name: "Report final.md",
            path: "/workspace/report.md",
            reference: "/workspace/report.md",
          },
        ]}
      />,
    );

    expect(screen.getByText("Report final.md")).toBeTruthy();
    expect(screen.queryByText("server-storage-name")).toBeNull();
  });
});
