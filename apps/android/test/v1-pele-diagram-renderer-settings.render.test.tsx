import { act, fireEvent, render, waitFor } from "@testing-library/react-native";

import {
  peleDiagramRendererEnabled$,
  writePeleDiagramRendererPreference,
} from "../src/data/peleDiagramRendererPreference";
import { PeleDiagramRendererSettings } from "../src/features/settings/PeleDiagramRendererSettings";

jest.mock("../src/data/peleDiagramRendererPreference", () => {
  const { observablePrimitive } =
    jest.requireActual<typeof import("@legendapp/state")>("@legendapp/state");
  const enabled$ = observablePrimitive(false);
  return {
    peleDiagramRendererEnabled$: enabled$,
    writePeleDiagramRendererPreference: jest.fn(async (enabled: boolean) => {
      enabled$.set(enabled);
    }),
  };
});

beforeEach(() => {
  peleDiagramRendererEnabled$.set(false);
  jest.clearAllMocks();
});

it("shows the fail-disabled Pele experiment and persists an explicit opt-in", async () => {
  const view = render(<PeleDiagramRendererSettings />);
  const toggle = view
    .getAllByLabelText("Pele diagram renderer")
    .find((candidate) => candidate.props.accessibilityRole === "switch");
  if (toggle === undefined) {
    throw new Error("Pele diagram renderer switch is missing");
  }

  expect(toggle.props.on).toBe(false);
  expect(view.getByText(/native SVG on a lazy worker instead of a WebView/u)).toBeTruthy();

  fireEvent(toggle, "change", { nativeEvent: { value: true } });

  await waitFor(() => {
    expect(writePeleDiagramRendererPreference).toHaveBeenCalledWith(true);
    const updatedToggle = view
      .getAllByLabelText("Pele diagram renderer")
      .find((candidate) => candidate.props.accessibilityRole === "switch");
    expect(updatedToggle?.props.on).toBe(true);
  });
  act(() => {
    peleDiagramRendererEnabled$.set(false);
  });
});
