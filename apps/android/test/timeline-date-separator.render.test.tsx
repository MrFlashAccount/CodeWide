import { describe, expect, it } from "@jest/globals";
import { render, screen } from "@testing-library/react-native";
import { StyleSheet } from "react-native";

import {
  TimelineDateSeparator,
} from "../src/rendering/TimelineDateSeparator";
import { TimelineDateSequence } from "../src/presentation/conversation/timelineDates";

describe("timeline date separator", () => {
  it("labels the first item and suppresses later items from the same local day", () => {
    const first = new Date(2024, 0, 2, 10).getTime();
    const later = new Date(2024, 0, 2, 12).getTime();

    const dates = new TimelineDateSequence(true);
    expect(dates.next(first)).toBe(
      new Date(first).toLocaleDateString(undefined, {
        day: "numeric",
        month: "long",
        year: "numeric",
      }),
    );
    expect(dates.next(later)).toBeNull();
  });

  it("labels the first item from a new local day", () => {
    const previous = new Date(2024, 0, 2, 23, 59).getTime();
    const current = new Date(2024, 0, 3, 0, 1).getTime();

    const dates = new TimelineDateSequence(false);
    dates.next(previous);
    expect(dates.next(current)).toBe(
      new Date(current).toLocaleDateString(undefined, {
        day: "numeric",
        month: "long",
        year: "numeric",
      }),
    );
  });

  it("fills the timeline row width", () => {
    render(<TimelineDateSeparator label="2 January 2024" />);

    expect(StyleSheet.flatten(screen.getByTestId("timeline-date-separator").props.style)).toMatchObject(
      { width: "100%" },
    );
  });
});
