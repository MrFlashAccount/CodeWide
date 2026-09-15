import { act, fireEvent, render, waitFor } from "@testing-library/react-native";
import { HeroUINativeProviderRaw } from "heroui-native/provider-raw";
import { PortalHost } from "heroui-native/portal";
import type { ReactNode } from "react";
import { Uniwind } from "uniwind";
import { ThreadRenameDialog } from "../src/features/turnActions/ThreadRenameDialog";

beforeAll(() => {
  // WHY: Metro registers theme variables on device; Node needs them for the real dialog controls.
  for (const theme of Uniwind.themes) Uniwind.updateCSSVariables(theme, { "--theme": "default" });
});

function Provider(props: { children: ReactNode }) {
  return <HeroUINativeProviderRaw config={{ animation: "disable-all", devInfo: { stylingPrinciples: false } }}>{props.children}<PortalHost /></HeroUINativeProviderRaw>;
}

it("opens a centered width-bounded dialog with the current name selected and explicit cancel", () => {
  const close = jest.fn();
  const rename = jest.fn(async () => undefined);
  const screen = render(<ThreadRenameDialog visible title="Original title" onClose={close} onRename={rename} />, { wrapper: Provider });
  expect(screen.getByTestId("thread-rename-dialog")).toHaveStyle({ maxWidth: 420, width: "100%" });
  expect(screen.getByTestId("thread-rename-keyboard-layout")).toHaveStyle({ justifyContent: "center" });
  const input = screen.getByLabelText("Thread name");
  expect(input.props.value).toBe("Original title");
  expect(input.props.autoFocus).toBe(true);
  expect(input.props.selectTextOnFocus).toBe(true);
  fireEvent.press(screen.getByRole("button", { name: "Cancel" }));
  expect(close).toHaveBeenCalledTimes(1);
  expect(rename).not.toHaveBeenCalled();
});

it("saves the trimmed name on Enter once and closes only after success", async () => {
  let finish: () => void = () => undefined;
  const response = new Promise<void>((resolve) => { finish = resolve; });
  const rename = jest.fn(() => response);
  const close = jest.fn();
  const screen = render(<ThreadRenameDialog visible title="Original" onClose={close} onRename={rename} />, { wrapper: Provider });
  fireEvent.changeText(screen.getByLabelText("Thread name"), "  New title  ");
  fireEvent(screen.getByLabelText("Thread name"), "submitEditing");
  fireEvent(screen.getByLabelText("Thread name"), "submitEditing");
  expect(rename).toHaveBeenCalledTimes(1);
  expect(rename).toHaveBeenCalledWith("New title");
  expect(close).not.toHaveBeenCalled();
  expect(screen.getByRole("button", { name: "Save" })).toBeDisabled();
  await act(async () => finish());
  await waitFor(() => expect(close).toHaveBeenCalledTimes(1));
});

it("rejects blank names and retains the edited name after failure for retry", async () => {
  const rename = jest.fn(async () => undefined).mockRejectedValueOnce(new Error("Server unavailable"));
  const close = jest.fn();
  const screen = render(<ThreadRenameDialog visible title="Original" onClose={close} onRename={rename} />, { wrapper: Provider });
  fireEvent.changeText(screen.getByLabelText("Thread name"), "   ");
  expect(screen.getByRole("button", { name: "Save" })).toBeDisabled();
  fireEvent(screen.getByLabelText("Thread name"), "submitEditing");
  expect(rename).not.toHaveBeenCalled();
  fireEvent.changeText(screen.getByLabelText("Thread name"), "Retry title");
  fireEvent.press(screen.getByRole("button", { name: "Save" }));
  await waitFor(() => expect(screen.getByRole("alert")).toHaveTextContent("Server unavailable"));
  expect(screen.getByLabelText("Thread name").props.value).toBe("Retry title");
  expect(screen.getByRole("button", { name: "Save" })).not.toBeDisabled();
  expect(close).not.toHaveBeenCalled();
  fireEvent.press(screen.getByRole("button", { name: "Save" }));
  await waitFor(() => expect(close).toHaveBeenCalledTimes(1));
  expect(rename).toHaveBeenCalledTimes(2);
  expect(rename).toHaveBeenLastCalledWith("Retry title");
});
