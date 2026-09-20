import { AlertDialog, BasicAlertDialog, RNHostView } from "@expo/ui/jetpack-compose";
import { act, fireEvent, render, waitFor } from "@testing-library/react-native";
import * as Clipboard from "expo-clipboard";
import type { ReactNode } from "react";

import { AppDialogSurface } from "../src/ui/AppDialogSurface.android";
import type { AppDialogRequest } from "../src/ui/AppDialog.types";

// WHY: Compose windows require Android. This adapter test verifies that dialogs
// use a native window instead of a root portal, preserving actions and dismissal.
jest.mock("@expo/ui/jetpack-compose", () => {
  const { Pressable, Text, View } =
    jest.requireActual<typeof import("react-native")>("react-native");
  const Slot = ({ children }: { children: ReactNode }) => <View>{children}</View>;
  const MaterialAlertDialog = Object.assign(
    ({ children, onDismissRequest }: { children: ReactNode; onDismissRequest(): void }) => (
      <View onDismissRequest={onDismissRequest} testID="material-alert-dialog">
        {children}
      </View>
    ),
    {
      ConfirmButton: Slot,
      DismissButton: Slot,
      Text: Slot,
      Title: Slot,
    },
  );
  return {
    AlertDialog: MaterialAlertDialog,
    Host: ({ children }: { children: ReactNode }) => <View>{children}</View>,
    BasicAlertDialog: ({ children }: { children: ReactNode; onDismissRequest(): void }) => (
      <View>{children}</View>
    ),
    RNHostView: ({ children }: { children: ReactNode; matchContents: boolean }) => (
      <View>{children}</View>
    ),
    Text,
    TextButton: ({ children, onClick }: { children: ReactNode; onClick(): void }) => (
      <Pressable accessibilityRole="button" onPress={onClick}>
        {children}
      </Pressable>
    ),
  };
});

const request: AppDialogRequest = {
  title: "Download failed",
  message: "Storage write failed",
  actions: [
    { text: "Cancel", style: "cancel" },
    { text: "Retry" },
    { text: "Delete", style: "destructive" },
  ],
};

afterEach(() => jest.restoreAllMocks());

it("copies the diagnostic without closing the error window and suppresses duplicate taps", async () => {
  let complete: () => void = () => undefined;
  const copy = jest.spyOn(Clipboard, "setStringAsync").mockImplementation(
    () =>
      new Promise<boolean>((resolve) => {
        complete = () => resolve(true);
      }),
  );
  const onAction = jest.fn();
  const onDismiss = jest.fn();
  const diagnostic = "Original error\nNative stack\nCaused by: EBADF";
  const view = render(
    <AppDialogSurface
      isOpen
      request={{ ...request, diagnostic }}
      onAction={onAction}
      onDismiss={onDismiss}
    />,
  );
  fireEvent.press(view.getByRole("button", { name: "Copy error" }));
  fireEvent.press(view.getByRole("button", { name: "Copy error" }));
  expect(copy).toHaveBeenCalledTimes(1);
  expect(copy).toHaveBeenCalledWith(diagnostic);
  await act(async () => complete());
  expect(view.getByText("Copied")).toBeVisible();
  expect(onAction).not.toHaveBeenCalled();
  expect(onDismiss).not.toHaveBeenCalled();
  expect(view.getByText("Download failed")).toBeVisible();
});

it("keeps the report and retry available if the clipboard fails", async () => {
  const copy = jest
    .spyOn(Clipboard, "setStringAsync")
    .mockRejectedValueOnce(new Error("Clipboard unavailable"))
    .mockResolvedValue(true);
  const view = render(
    <AppDialogSurface
      isOpen
      request={{ ...request, diagnostic: "EBADF stack" }}
      onAction={jest.fn()}
      onDismiss={jest.fn()}
    />,
  );
  fireEvent.press(view.getByRole("button", { name: "Copy error" }));
  await waitFor(() => expect(view.getByText("Could not copy. Tap to retry.")).toBeVisible());
  fireEvent.press(view.getByRole("button", { name: "Copy error" }));
  await waitFor(() => expect(view.getByText("Copied")).toBeVisible());
  expect(copy).toHaveBeenLastCalledWith("EBADF stack");
});

it("places the complete error and every action inside a native dialog window", () => {
  const onAction = jest.fn();
  const onDismiss = jest.fn();
  const view = render(
    <AppDialogSurface isOpen request={request} onAction={onAction} onDismiss={onDismiss} />,
  );
  const window = view.UNSAFE_getByType(BasicAlertDialog);
  expect(window.findByType(RNHostView).props.matchContents).toBe(true);
  expect(view.getByText(request.title)).toBeVisible();
  expect(view.getByText("Storage write failed")).toBeVisible();
  for (const action of request.actions) {
    fireEvent.press(view.getByRole("button", { name: action.text }));
    expect(onAction).toHaveBeenLastCalledWith(action);
  }
  fireEvent(window, "dismissRequest");
  expect(onDismiss).toHaveBeenCalledTimes(1);
});

it("uses the structured Material alert surface for ordinary confirmations", () => {
  const cancel = { style: "cancel" as const, text: "Cancel" };
  const confirm = { style: "destructive" as const, text: "Use" };
  const onAction = jest.fn();
  const onDismiss = jest.fn();
  const view = render(
    <AppDialogSurface
      isOpen
      onAction={onAction}
      onDismiss={onDismiss}
      request={{
        actions: [cancel, confirm],
        message: "This action cannot be undone.",
        title: "Use Full reset?",
      }}
    />,
  );

  expect(view.UNSAFE_queryAllByType(BasicAlertDialog)).toHaveLength(0);
  expect(view.UNSAFE_getByType(AlertDialog)).toBeTruthy();
  expect(view.getByText("Use Full reset?")).toBeVisible();
  expect(view.getByText("This action cannot be undone.")).toBeVisible();
  fireEvent.press(view.getByRole("button", { name: "Cancel" }));
  expect(onAction).toHaveBeenLastCalledWith(cancel);
  fireEvent.press(view.getByRole("button", { name: "Use" }));
  expect(onAction).toHaveBeenLastCalledWith(confirm);
  fireEvent(view.getByTestId("material-alert-dialog"), "dismissRequest");
  expect(onDismiss).toHaveBeenCalledTimes(1);
});

it("removes the native window on dismissal and can show a later request", () => {
  const onAction = jest.fn();
  const onDismiss = jest.fn();
  const view = render(
    <AppDialogSurface isOpen={false} request={request} onAction={onAction} onDismiss={onDismiss} />,
  );
  expect(view.UNSAFE_queryAllByType(BasicAlertDialog)).toHaveLength(0);
  view.rerender(
    <AppDialogSurface isOpen request={request} onAction={onAction} onDismiss={onDismiss} />,
  );
  expect(view.UNSAFE_queryAllByType(BasicAlertDialog)).toHaveLength(1);
  view.rerender(
    <AppDialogSurface isOpen={false} request={request} onAction={onAction} onDismiss={onDismiss} />,
  );
  expect(view.UNSAFE_queryAllByType(BasicAlertDialog)).toHaveLength(0);
  view.rerender(
    <AppDialogSurface
      isOpen
      request={{ title: "Saved", actions: [{ text: "OK" }] }}
      onAction={onAction}
      onDismiss={onDismiss}
    />,
  );
  expect(view.getByText("Saved")).toBeVisible();
  expect(view.queryByText("Storage write failed")).toBeNull();
});
