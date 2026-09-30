import { act, fireEvent, render, waitFor } from "@testing-library/react-native";

import {
  timelineRowPremeasurementEnabled$,
  writeTimelineRowPremeasurementPreference,
} from "../src/data/timelineRowPremeasurementPreference";
import { TimelineRowMeasurementSettings } from "../src/features/settings/TimelineRowMeasurementSettings";

jest.mock("../src/data/timelineRowPremeasurementPreference", () => {
  const { observablePrimitive } =
    jest.requireActual<typeof import("@legendapp/state")>("@legendapp/state");
  const enabled$ = observablePrimitive(false);
  return {
    timelineRowPremeasurementEnabled$: enabled$,
    writeTimelineRowPremeasurementPreference: jest.fn(async (enabled: boolean) => {
      enabled$.set(enabled);
    }),
  };
});

beforeEach(() => {
  timelineRowPremeasurementEnabled$.set(false);
  jest.clearAllMocks();
});

it("shows the fail-disabled row measurement experiment and persists an explicit opt-in", async () => {
  const view = render(<TimelineRowMeasurementSettings />);
  const toggle = view
    .getAllByLabelText("Premeasure message heights")
    .find((candidate) => candidate.props.accessibilityRole === "switch");
  if (toggle === undefined) {
    throw new Error("Timeline row premeasurement switch is missing");
  }

  expect(toggle.props.on).toBe(false);
  expect(view.getByText(/Estimate every row at 115 dp/u)).toBeTruthy();

  fireEvent(toggle, "change", { nativeEvent: { value: true } });

  await waitFor(() => {
    expect(writeTimelineRowPremeasurementPreference).toHaveBeenCalledWith(true);
    const updatedToggle = view
      .getAllByLabelText("Premeasure message heights")
      .find((candidate) => candidate.props.accessibilityRole === "switch");
    expect(updatedToggle?.props.on).toBe(true);
  });
  act(() => {
    timelineRowPremeasurementEnabled$.set(false);
  });
});
