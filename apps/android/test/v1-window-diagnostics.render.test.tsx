import { act, fireEvent, render, waitFor } from "@testing-library/react-native";
import * as Clipboard from "expo-clipboard";
import { Dimensions } from "react-native";

import { WindowDiagnostics } from "../src/features/diagnostics/WindowDiagnostics";
import { workspaceCatalogDiagnostics } from "../src/data/workspaceCatalogDiagnostics";

jest.mock("expo-clipboard", () => ({ setStringAsync: jest.fn(async () => undefined) }));

jest.mock("../src/native/windowDiagnostics", () => ({
  windowDiagnosticsPort: () => ({
    status: "available",
    getRecording: async () => false,
    setRecording: async (enabled: boolean) => enabled,
    captureReport: async () => 'NATIVE_GEOMETRY_HISTORY',
  }),
}));

it("keeps recording outside settings and exports windowed evidence after returning fullscreen", async () => {
  const initial = Dimensions.get("window");
  const screen = Dimensions.get("screen");
  let view = render(<WindowDiagnostics />);
  await waitFor(() => expect(view.getByLabelText("Record window diagnostics")).toBeEnabled());
  fireEvent(view.getByLabelText("Record window diagnostics"), "valueChange", true);
  await waitFor(() => expect(view.getByLabelText("Record window diagnostics")).toBeChecked());
  view.unmount();

  workspaceCatalogDiagnostics.record({
    type: "navigation",
    catalog: "missing-route",
    desktop: true,
    focused: false,
    viewportWidth: 900,
  });

  act(() => Dimensions.set({ window: { ...initial, width: 320, scale: 1.5 }, screen }));
  act(() => Dimensions.set({ window: { ...initial, width: 900, scale: 3 }, screen }));

  view = render(<WindowDiagnostics />);
  expect(view.getByLabelText("Record window diagnostics")).toBeChecked();
  fireEvent(view.getByLabelText("Record window diagnostics"), "valueChange", false);
  await waitFor(() => expect(view.getByLabelText("Record window diagnostics")).not.toBeChecked());
  act(() => Dimensions.set({ window: { ...initial, width: 777 }, screen }));
  fireEvent.press(view.getByLabelText("Copy window report"));
  await waitFor(() => expect(view.getByText("Copied")).toBeVisible());

  const report = jest.mocked(Clipboard.setStringAsync).mock.calls[0]?.[0];
  expect(report).toContain("NATIVE_GEOMETRY_HISTORY");
  expect(report).toContain("Workspace catalog rendering");
  expect(report).toContain('"catalog": "missing-route"');
  expect(report).toContain('"width": 320');
  expect(report).toContain('"width": 900');
  expect(report).not.toContain('"width": 777');

  fireEvent(view.getByLabelText("Record window diagnostics"), "valueChange", true);
  await waitFor(() => expect(view.getByLabelText("Record window diagnostics")).toBeChecked());
  fireEvent(view.getByLabelText("Record window diagnostics"), "valueChange", false);
  await waitFor(() => expect(view.getByLabelText("Record window diagnostics")).not.toBeChecked());
  fireEvent.press(view.getByLabelText("Copy window report"));
  await waitFor(() => expect(jest.mocked(Clipboard.setStringAsync)).toHaveBeenCalledTimes(2));
  const nextReport = jest.mocked(Clipboard.setStringAsync).mock.calls[1]?.[0];
  expect(nextReport).toContain('"width": 777');
  expect(nextReport).not.toContain('"width": 320');
  view.unmount();
  Dimensions.set({ window: initial, screen });
});

it("bounds catalog history while retaining the latest zero-size and unmount evidence", () => {
  workspaceCatalogDiagnostics.record({
    type: "navigation", catalog: "missing-descriptor", desktop: true, focused: false, viewportWidth: 1024,
  });
  workspaceCatalogDiagnostics.record({ type: "layout", surface: "pane", width: 12345, height: 600 });
  workspaceCatalogDiagnostics.record({ type: "layout", surface: "pane", width: 320, height: 600 });
  for (let index = 0; index < 80; index += 1) {
    workspaceCatalogDiagnostics.record({ type: "layout", surface: "content", width: index, height: 0 });
  }
  workspaceCatalogDiagnostics.record({ type: "content", state: "unmounted" });
  const report = workspaceCatalogDiagnostics.report();
  expect(report).not.toContain('"width": 12345');
  expect(report).toContain('"width": 79');
  expect(report).toContain('"height": 0');
  expect(report).toContain('"state": "unmounted"');
  // Layout churn must not evict the last navigation observation needed to diagnose a blank pane.
  expect(report).toContain('"catalog": "missing-descriptor"');
});
