import { fireEvent, render } from "@testing-library/react-native";
import { HostUpdateSettings } from "../src/features/connections/HostUpdateSettings";
import type { HostUpdateView } from "../src/features/connections/hostUpdateSettingsContract";
import { getAppDialogRequest, invokeAppDialogAction, resetAppDialog } from "../src/ui/AppDialog";

jest.mock("../src/ui/WaveText", () => {
  const { Text } = jest.requireActual<typeof import("react-native")>("react-native");
  return {
    WaveText: ({ testID, text }: { readonly testID: string; readonly text: string }) => (
      <Text testID={testID}>{text}</Text>
    ),
  };
});

const FINGERPRINT = "b".repeat(64);

afterEach(() => {
  resetAppDialog();
});

it("confirms the temporary disconnect and rollback before applying the exact shown target", () => {
  const onApply = jest.fn(async () => undefined);
  const view = render(<Fixture onApply={onApply} update={available()} />);
  fireEvent.press(view.getByLabelText("Update Companion"));
  expect(getAppDialogRequest()).toMatchObject({
    title: "Update Companion?",
  });
  expect(getAppDialogRequest()?.message).toContain("temporarily disconnect");
  expect(getAppDialogRequest()?.message).toContain("automatically roll back");
  invokeAppDialogAction("Update Companion");
  expect(onApply).toHaveBeenCalledWith("server", FINGERPRINT);
});

it("keeps the real version shimmering while the Companion is disconnected", () => {
  const view = render(
    <Fixture
      update={{
        ...available(),
        canApply: false,
        canCheck: false,
        disconnected: true,
        operationId: "operation-00000000000000000000",
        phase: "installing",
      }}
    />,
  );
  expect(view.getByTestId("host-update-version-shimmer").props.children).toBe("1.0.0");
  expect(view.getByText(/device remains paired/u)).toBeTruthy();
  expect(view.queryByText("Updating…")).toBeNull();
});

it.each([
  ["committed", null, "Companion updated and reconnected successfully."],
  ["rolledBack", "New Companion did not reconnect", "Update rolled back:"],
  ["failed", "Artifact verification failed", "Update failed:"],
] as const)("renders the durable %s outcome", (phase, errorMessage, expected) => {
  const view = render(
    <Fixture
      update={{
        ...available(),
        canApply: phase !== "committed",
        canRetry: phase !== "committed",
        errorCode: errorMessage === null ? null : "guardian_failure",
        errorMessage,
        operationId: "operation-00000000000000000000",
        phase,
      }}
    />,
  );
  expect(view.getByText(new RegExp(expected, "u"))).toBeTruthy();
  if (phase !== "committed") {
    expect(view.getByLabelText("Retry Companion update")).toBeTruthy();
  }
});

it.each([
  ["unsupported", "cannot update remotely"],
  ["manualBootstrap", "update guardian must be installed manually"],
  ["manualUpdate", "requires a manual update"],
] as const)("renders %s as a distinct manual recovery state", (availability, expected) => {
  const view = render(
    <Fixture
      update={{
        ...available(),
        availability,
        canApply: false,
        canCheck: false,
        latestVersion: null,
        targetFingerprint: null,
      }}
    />,
  );
  expect(view.getByText(new RegExp(expected, "iu"))).toBeTruthy();
  expect(view.queryByLabelText("Update Companion")).toBeNull();
});

it("offers an accessible check action after a stale target", () => {
  const onCheck = jest.fn(async () => undefined);
  const view = render(
    <Fixture
      onCheck={onCheck}
      update={{
        ...available(),
        availability: "error",
        canApply: false,
        canCheck: true,
        errorCode: "stale_target",
        errorMessage: "The available release changed.",
      }}
    />,
  );
  fireEvent.press(view.getByLabelText("Check for Companion updates"));
  expect(onCheck).toHaveBeenCalledWith("server");
  expect(view.getByText(/available release changed/u)).toBeTruthy();
});

function Fixture({
  onApply = async () => undefined,
  onCheck = async () => undefined,
  update,
}: {
  readonly onApply?: (connectionId: string, targetFingerprint: string) => Promise<void>;
  readonly onCheck?: (connectionId: string) => Promise<void>;
  readonly update: HostUpdateView;
}) {
  return (
    <HostUpdateSettings
      connectionId="server"
      connectionName="Buddy"
      onApply={onApply}
      onCheck={onCheck}
      update={update}
    />
  );
}

function available(): HostUpdateView {
  return {
    availability: "ready",
    canApply: true,
    canCheck: true,
    canRetry: false,
    currentVersion: "1.0.0",
    disconnected: false,
    errorCode: null,
    errorMessage: null,
    latestVersion: "1.1.0",
    operationId: null,
    phase: null,
    platform: "macos-universal",
    targetFingerprint: FINGERPRINT,
  };
}
