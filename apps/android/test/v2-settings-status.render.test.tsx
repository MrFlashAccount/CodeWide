import { describe, expect, it, jest } from "@jest/globals";
import { fireEvent, render, screen } from "@testing-library/react-native";
import { Text } from "react-native";

import { ConnectionSettingsView } from "../src/v2/presentation/settings/ConnectionSettingsView";

describe("V2 connection settings status", () => {
  it("renders an updating session as shimmer with its safe reconnect diagnostic", () => {
    render(
      <ConnectionSettingsView
        appLockBusy={false}
        appLockEnabled={false}
        diagnostics={<Text>Diagnostics</Text>}
        error={null}
        generationControl={<Text>Generation</Text>}
        onAppLockChange={jest.fn()}
        onClose={jest.fn()}
        onServerAction={jest.fn()}
        onServerEnabledChange={jest.fn()}
        servers={[
          {
            detail: "https://buddy.example",
            diagnostic: "sourceGap",
            emoji: "🖥️",
            enabled: true,
            id: "buddy",
            label: "Buddy",
            state: "updating",
          },
        ]}
        version="test"
      />,
    );

    expect(screen.getByLabelText("Updating")).toBeTruthy();
    expect(screen.getByText("sourceGap").props.selectable).toBe(true);
  });

  it("distinguishes an access-required connection from a generic outage", () => {
    render(
      <ConnectionSettingsView
        appLockBusy={false}
        appLockEnabled={false}
        diagnostics={<Text>Diagnostics</Text>}
        error={null}
        generationControl={<Text>Generation</Text>}
        onAppLockChange={jest.fn()}
        onClose={jest.fn()}
        onServerAction={jest.fn()}
        onServerEnabledChange={jest.fn()}
        servers={[
          {
            detail: "https://buddy.example",
            diagnostic: "Authorization required",
            emoji: "🖥️",
            enabled: true,
            id: "buddy",
            label: "Buddy",
            state: "accessRequired",
          },
        ]}
        version="test"
      />,
    );

    expect(screen.getByText("Access required")).toBeTruthy();
    expect(screen.getByText("Authorization required")).toBeTruthy();
  });

  it("exposes retry and diagnostic-copy actions for a failed connection", () => {
    const onServerAction = jest.fn();
    render(
      <ConnectionSettingsView
        appLockBusy={false}
        appLockEnabled={false}
        diagnostics={<Text>Diagnostics</Text>}
        error={null}
        generationControl={<Text>Generation</Text>}
        onAppLockChange={jest.fn()}
        onClose={jest.fn()}
        onServerAction={onServerAction}
        onServerEnabledChange={jest.fn()}
        servers={[
          {
            detail: "https://buddy.example",
            diagnostic: "TLS pin mismatch",
            emoji: "🖥️",
            enabled: true,
            id: "buddy",
            label: "Buddy",
            state: "error",
          },
        ]}
        version="test"
      />,
    );

    fireEvent.press(screen.getByLabelText("Actions for Buddy"));
    fireEvent.press(screen.getByLabelText("Actions for Buddy: Retry connection"));
    fireEvent.press(screen.getByLabelText("Actions for Buddy: Copy connection error"));

    expect(onServerAction).toHaveBeenNthCalledWith(1, "buddy", "reconnect");
    expect(onServerAction).toHaveBeenNthCalledWith(2, "buddy", "copyDiagnostic");
  });
});
