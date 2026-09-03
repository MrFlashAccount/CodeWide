import { describe, expect, it, jest } from "@jest/globals";
import { act, fireEvent, render, screen } from "@testing-library/react-native";
import { ActivityIndicator } from "react-native";

import { RootGenerationStatusView } from "../src/boot/RootGenerationGate";

jest.mock("../src/boot/uiGenerationResource", () => ({
  retryUiGeneration: () => undefined,
  subscribeUiGeneration: () => () => undefined,
  uiGenerationSnapshot: () => ({ status: "loading" }),
}));

describe("root UI generation gate", () => {
  it("renders accessible shimmer progress without a spinner while booting", () => {
    render(<RootGenerationStatusView onRetry={() => undefined} snapshot={{ status: "loading" }} />);

    expect(screen.getByTestId("generation-boot-state")).toBeTruthy();
    expect(screen.getByTestId("v2-progress-shimmer").props.accessibilityLabel).toBe(
      "Starting CodeWide…",
    );
    expect(screen.UNSAFE_queryAllByType(ActivityIndicator)).toHaveLength(0);
  });

  it("keeps an accessible error and retry escape", async () => {
    const retry = jest.fn();
    render(
      <RootGenerationStatusView
        onRetry={retry}
        snapshot={{ message: "Could not read UI generation", status: "error" }}
      />,
    );

    expect(screen.getByText("Could not read UI generation").props.accessibilityLiveRegion).toBe(
      "polite",
    );
    await act(async () => fireEvent.press(screen.getByLabelText("Try again")));
    expect(retry).toHaveBeenCalledTimes(1);
  });
});
