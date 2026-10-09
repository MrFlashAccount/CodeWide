import { act, render } from "@testing-library/react-native";
import { StyleSheet } from "react-native";
import { WaveText } from "../src/ui/WaveText";
import { PerformanceExperimentProvider, resetPerformanceExperiments, setPerformanceExperiment } from "../src/data/performance-experiments";
import { typeScale } from "../src/theme";

// WHY: TextShimmer only decorates on Android; force the platform so the
// shimmer path runs. The decoration itself needs a device and stays a no-op.
jest.mock("react-native", () => {
  const native = jest.requireActual("react-native");
  return new Proxy(native, {
    get(target, key) {
      if (key === "Platform") return { ...target.Platform, OS: "android" };
      return Reflect.get(target, key);
    },
  });
});

afterEach(() => { act(() => resetPerformanceExperiments()); });

it.each(["One line", "First line\nSecond line\nThird line"])("renders one ordinary text whose metrics the shimmer never changes: %s", (text) => {
  const result = render(<PerformanceExperimentProvider>
    <WaveText text={text} style={typeScale.body} numberOfLines={0} />
  </PerformanceExperimentProvider>);
  expect(result.getAllByText(text, { includeHiddenElements: true })).toHaveLength(1);
  const shimmering = StyleSheet.flatten(result.getByText(text).props.style);
  expect(shimmering).toMatchObject({ includeFontPadding: false, fontSize: typeScale.body.fontSize,
    lineHeight: typeScale.body.lineHeight });
  expect(shimmering.opacity).toBeUndefined();
  expect(result.getByText(text).props.numberOfLines).toBe(0);
  expect(result.getByTestId("active-text-shimmer")).not.toHaveStyle({ paddingVertical: expect.any(Number) });

  act(() => setPerformanceExperiment("disableTextShimmer", true));
  const still = result.getByText(text);
  expect(StyleSheet.flatten(still.props.style)).toEqual(shimmering);
  expect(still.props.numberOfLines).toBe(0);
});

it("keeps the collapsed line limit when reduced motion stops the shimmer", () => {
  const result = render(<PerformanceExperimentProvider>
    <WaveText text="A long pending message" style={typeScale.body} numberOfLines={6} />
  </PerformanceExperimentProvider>);
  expect(result.getByText("A long pending message").props.numberOfLines).toBe(6);
  act(() => setPerformanceExperiment("reduceCustomMotion", true));
  expect(result.getByText("A long pending message").props.numberOfLines).toBe(6);
  expect(result.getByText("A long pending message")).toHaveStyle({ includeFontPadding: false });
});
