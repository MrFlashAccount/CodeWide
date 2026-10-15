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
  expect(view.getByTestId("host-update-version-shimmer").props.children).toBe("Companion 1.0.0");
  expect(view.getByText(/device remains paired/u)).toBeTruthy();
  expect(view.queryByText("Updating…")).toBeNull();
});

it("confirms a committed update next to the new version", () => {
  const view = render(
    <Fixture
      update={{
        ...available(),
        canApply: false,
        currentVersion: "1.1.0",
        latestVersion: "1.1.0",
        operationId: "operation-00000000000000000000",
        phase: "committed",
      }}
    />,
  );
  expect(view.getByText("Companion 1.1.0")).toBeTruthy();
  expect(view.getByText("macOS · updated")).toBeTruthy();
  expect(view.queryByLabelText("Update Companion")).toBeNull();
});

it("shows received download progress and identifies a stale observation during reconnect", () => {
  const update: HostUpdateView = { ...available(), phase: "installing", canApply: false, canCheck: false,
    progress: { stage: "downloading", downloadedBytes: 5_000_000, totalBytes: 10_000_000 } };
  const view = render(<Fixture update={update} />);
  expect(view.getByText(/Downloading · 50% · 5.0 \/ 10.0 MB. Companion is reachable/u)).toBeTruthy();
  view.rerender(<Fixture update={{ ...update, disconnected: true }} />);
  expect(view.getByText(/Last confirmed: Downloading · 50%/u)).toBeTruthy();
  expect(view.queryByText(/Companion is reachable/u)).toBeNull();
});

it.each([
  ["rolledBack", "New Companion did not reconnect", "Update rolled back: New Companion did not reconnect"],
  ["failed", "Artifact verification failed", "Update failed: Artifact verification failed"],
  ["failed", null, "The update failed. The current Companion version keeps running."],
] as const)("renders the durable %s outcome with a retry", (phase, errorMessage, expected) => {
  const onApply = jest.fn(async () => undefined);
  const view = render(
    <Fixture
      onApply={onApply}
      update={{
        ...available(),
        canRetry: true,
        errorCode: errorMessage === null ? null : "guardian_failure",
        errorMessage,
        operationId: "operation-00000000000000000000",
        phase,
      }}
    />,
  );
  expect(view.getByText(expected)).toBeTruthy();
  expect(view.queryByLabelText("Update Companion")).toBeNull();
  fireEvent.press(view.getByLabelText("Retry Companion update"));
  invokeAppDialogAction("Update Companion");
  expect(onApply).toHaveBeenCalledWith("server", FINGERPRINT);
});

it("shows a manual-update rejection as setup guidance, not as a failed update", () => {
  const view = render(
    <Fixture
      update={{
        ...available(),
        availability: "manualBootstrap",
        canApply: false,
        canCheck: false,
        errorCode: "manual_update_required",
        errorMessage: null,
        latestVersion: null,
        platform: "linux-x86-64",
        targetFingerprint: null,
      }}
    />,
  );
  expect(view.getByText("Linux · remote updates not set up")).toBeTruthy();
  expect(view.getByText(/install\/companion \| sh$/u)).toBeTruthy();
  expect(view.getByLabelText("Copy installer command")).toBeTruthy();
  expect(view.queryByText(/Update failed/u)).toBeNull();
});

it("tells an unofficial build apart and offers no installer that could replace it", () => {
  const view = render(
    <Fixture
      update={{
        ...available(),
        availability: "unofficialBuild",
        canApply: false,
        canCheck: false,
        latestVersion: null,
        platform: "linux-x86-64",
        targetFingerprint: null,
      }}
    />,
  );
  expect(view.getByText("Linux · unofficial build")).toBeTruthy();
  expect(view.getByText(/built outside an official release/u)).toBeTruthy();
  expect(view.queryByLabelText("Copy installer command")).toBeNull();
});

it.each([
  ["unsupported", "cannot update remotely"],
  ["manualBootstrap", "set up safe remote updates"],
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

it("names a failed request without claiming that an update failed", () => {
  const view = render(
    <Fixture
      update={{
        ...available(),
        availability: "error",
        canApply: false,
        canCheck: true,
        errorCode: "relay_update_failed",
        errorMessage: "Could not connect to the Relay.",
        phase: null,
      }}
    />,
  );
  expect(view.getByText("Update request failed: Could not connect to the Relay.")).toBeTruthy();
  expect(view.queryByText(/Update failed/u)).toBeNull();
});

it("keeps Update in place, busy, while the server has not acknowledged it", () => {
  const view = render(
    <Fixture update={{ ...available(), canApply: false, canCheck: false, pending: "apply" }} />,
  );
  expect(view.getByTestId("host-update-version-shimmer").props.children).toBe("Companion 1.0.0");
  expect(view.getByText("macOS · 1.1.0 available")).toBeTruthy();
  const update = view.getByLabelText("Update Companion");
  expect(update.props.accessibilityState).toMatchObject({ busy: true, disabled: true });
  expect(view.queryByText(/Updating|accepted/u)).toBeNull();
});

it("shimmers the version while a requested check is pending", () => {
  const view = render(
    <Fixture update={{ ...available(), canApply: false, canCheck: false, pending: "check" }} />,
  );
  expect(view.getByTestId("host-update-version-shimmer").props.children).toBe("Companion 1.0.0");
  expect(view.getByLabelText("Check for Companion updates").props.accessibilityState).toMatchObject({
    busy: true,
  });
});

it("labels an unreachable restarting server as the last confirmed state, not a failure", () => {
  const view = render(
    <Fixture subject="Relay" update={{ ...available(), canApply: false, disconnected: true }} />,
  );
  expect(view.getByText("macOS · 1.1.0 available · reconnecting")).toBeTruthy();
  expect(view.getByText(/Last confirmed: 1.1.0 available. Waiting for fresh Relay status/u)).toBeTruthy();
  expect(view.queryByText(/failed/iu)).toBeNull();
});

it.each([
  ["macos-universal", "macOS"],
  ["linux-x86-64", "Linux"],
] as const)("renders %s install progress the same way", (platform, label) => {
  const progress = { stage: "downloading", downloadedBytes: 34_000_000, totalBytes: 59_000_000 } as const;
  const installing: HostUpdateView = {
    ...available(),
    canApply: false,
    canCheck: false,
    phase: "installing",
    platform,
    progress,
  };
  const view = render(<Fixture update={installing} />);
  expect(view.getByText(`${label} · Downloading · 57% · 34.0 / 59.0 MB`)).toBeTruthy();
  view.rerender(
    <Fixture subject="Relay" update={{ ...installing, progress: { stage: "restarting" } }} />,
  );
  expect(view.getByText(`${label} · Restarting Relay`)).toBeTruthy();
});

function Fixture({
  onApply = async () => undefined,
  onCheck = async () => undefined,
  subject = "Companion",
  update,
}: {
  readonly onApply?: (connectionId: string, targetFingerprint: string) => Promise<void>;
  readonly onCheck?: (connectionId: string) => Promise<void>;
  readonly subject?: "Companion" | "Relay";
  readonly update: HostUpdateView;
}) {
  return (
    <HostUpdateSettings
      connectionId="server"
      connectionName="Buddy"
      onApply={onApply}
      onCheck={onCheck}
      subject={subject}
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
    pending: null,
    phase: null,
    platform: "macos-universal",
    progress: null,
    targetFingerprint: FINGERPRINT,
  };
}
