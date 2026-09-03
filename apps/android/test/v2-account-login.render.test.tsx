import { describe, expect, it, jest } from "@jest/globals";
import { fireEvent, render, screen, waitFor } from "@testing-library/react-native";
import { Pressable, Text } from "react-native";

import type { AccountLoginStart } from "../src/v2/features/settings/useAccountLogin";
import { useAccountLogin } from "../src/v2/features/settings/useAccountLogin";
import { AccountLoginSheetView } from "../src/v2/presentation/settings/AccountLoginSheetView";

describe("V2 account login presentation", () => {
  it("shows the device code and exposes copy, browser, and cancellation actions", () => {
    const close = jest.fn();
    const copy = jest.fn();
    const open = jest.fn();
    render(
      <AccountLoginSheetView
        codeCopied={false}
        error={null}
        onClose={close}
        onCopy={copy}
        onOpen={open}
        pending={false}
        userCode="ABCD-EFGH"
      />,
    );

    expect(screen.getByText("ABCD-EFGH").props.selectable).toBe(true);
    fireEvent.press(screen.getByLabelText("Copy one-time Codex sign-in code"));
    fireEvent.press(screen.getByLabelText("Open Codex sign-in"));
    fireEvent.press(screen.getByLabelText("Close Codex account sign-in"));
    expect(copy).toHaveBeenCalledTimes(1);
    expect(open).toHaveBeenCalledTimes(1);
    expect(close).toHaveBeenCalledTimes(1);
  });

  it("disables all actions while a login transition is pending", () => {
    render(
      <AccountLoginSheetView
        codeCopied
        error="Still waiting"
        onClose={jest.fn()}
        onCopy={jest.fn()}
        onOpen={jest.fn()}
        pending
        userCode="ABCD-EFGH"
      />,
    );

    expect(screen.getByLabelText("Open Codex sign-in").props.accessibilityState).toEqual({
      busy: true,
      disabled: true,
    });
    expect(
      screen.getByLabelText("Copy one-time Codex sign-in code").props.accessibilityState,
    ).toEqual({ disabled: true });
    expect(screen.getByText("Still waiting")).toBeTruthy();
  });

  it("settles a failed start and permits the same explicit action to retry", async () => {
    const start = jest
      .fn<() => Promise<AccountLoginStart>>()
      .mockRejectedValueOnce(new Error("Observer is unavailable"))
      .mockResolvedValueOnce(LOGIN);
    render(
      <AccountLoginHarness
        cancel={async () => undefined}
        copy={async () => undefined}
        open={async () => undefined}
        start={start}
      />,
    );

    fireEvent.press(screen.getByLabelText("Begin login"));
    expect(await screen.findByText("Observer is unavailable")).toBeTruthy();
    expect(screen.getByLabelText("Begin login").props.disabled).not.toBe(true);

    fireEvent.press(screen.getByLabelText("Begin login"));
    expect(await screen.findByText("ABCD-EFGH")).toBeTruthy();
    expect(start).toHaveBeenCalledTimes(2);
  });

  it("closes immediately while still cancelling the abandoned server login", async () => {
    const cancel = jest.fn(async () => undefined);
    render(
      <AccountLoginHarness
        cancel={cancel}
        copy={async () => undefined}
        open={async () => undefined}
        start={async () => LOGIN}
      />,
    );

    fireEvent.press(screen.getByLabelText("Begin login"));
    expect(await screen.findByText("ABCD-EFGH")).toBeTruthy();
    fireEvent.press(screen.getByLabelText("Close login"));

    await waitFor(() => {
      expect(screen.queryByText("ABCD-EFGH")).toBeNull();
      expect(cancel).toHaveBeenCalledWith("login-1");
    });
  });
});

interface AccountLoginHarnessProps {
  cancel(loginId: string): Promise<void>;
  copy(value: string): Promise<void>;
  open(value: string): Promise<void>;
  start(): Promise<AccountLoginStart>;
}

function AccountLoginHarness(props: AccountLoginHarnessProps): React.JSX.Element {
  const login = useAccountLogin(props);
  return (
    <>
      <Pressable accessibilityLabel="Begin login" disabled={login.pending} onPress={login.begin} />
      {login.error === null ? null : <Text>{login.error}</Text>}
      {login.login === null ? null : (
        <>
          <Text>{login.login.userCode}</Text>
          <Pressable accessibilityLabel="Close login" onPress={login.close} />
        </>
      )}
    </>
  );
}

const LOGIN: AccountLoginStart = {
  loginId: "login-1",
  userCode: "ABCD-EFGH",
  verificationUrl: "https://auth.example/device",
};
