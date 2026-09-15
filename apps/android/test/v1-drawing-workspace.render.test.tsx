import { act, fireEvent, render } from "@testing-library/react-native";
import { DrawingWorkspace, type DrawingCommit } from "../src/features/drawing/DrawingWorkspace";

it("retains the editor while admission is pending and closes only after acceptance", async () => {
  let settle: (accepted: boolean) => void = () => { throw new Error("Admission has not started"); };
  const onCommit = jest.fn((_value: DrawingCommit) => new Promise<boolean>((resolve) => { settle = resolve; }));
  const onClose = jest.fn();
  const view = render(<DrawingWorkspace editing={false} initialSnapshot={null} mode="drawing" onCommit={onCommit} onClose={onClose} />);
  await act(async () => fireEvent.press(view.getByLabelText("Attach drawing")));
  expect(onCommit).toHaveBeenCalledTimes(1);
  expect(onCommit.mock.calls[0]?.[0]).toEqual({ pngDataUrl: "data:image/png;base64,AQID", snapshot: { document: { store: {} } } });
  expect(view.getByLabelText("Attach drawing").props.accessibilityState.disabled).toBe(true);
  fireEvent.press(view.getByLabelText("Attach drawing"));
  expect(onCommit).toHaveBeenCalledTimes(1);
  await act(async () => settle(false));
  expect(onClose).not.toHaveBeenCalled();
  expect(view.getByLabelText("Attach drawing").props.accessibilityState.disabled).toBe(false);
  await act(async () => fireEvent.press(view.getByLabelText("Attach drawing")));
  await act(async () => settle(true));
  expect(onClose).toHaveBeenCalledTimes(1);
});

it("keeps a rejected drawing open and permits retry", async () => {
  const onClose = jest.fn();
  const onCommit = jest.fn(async () => { throw new Error("Upload admission failed"); });
  const view = render(<DrawingWorkspace editing initialSnapshot={null} mode="image-annotation" onCommit={onCommit} onClose={onClose} />);
  await act(async () => fireEvent.press(view.getByLabelText("Save drawing")));
  expect(view.getByText("Upload admission failed")).toBeTruthy();
  expect(onClose).not.toHaveBeenCalled();
  expect(view.getByLabelText("Save drawing").props.accessibilityState.disabled).toBe(false);
});
