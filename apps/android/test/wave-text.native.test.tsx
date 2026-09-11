import { act, render } from "@testing-library/react-native";
import { StyleSheet } from "react-native";
import { WaveText } from "../src/ui/WaveText";
import { PerformanceExperimentProvider, resetPerformanceExperiments, setPerformanceExperiment } from "../src/data/performance-experiments";
import { typeScale } from "../src/theme";

// WHY: The Android view manager needs a device. Keep real text measurement
// props and WaveText state; only replace the unavailable native drawing host.
jest.mock("react-native", () => {
  const native = jest.requireActual("react-native");
  return new Proxy(native, {
    get(target, key) {
      if (key === "Platform") return { ...target.Platform, OS: "android" };
      if (key === "requireNativeComponent") return (name: string) => name;
      return Reflect.get(target, key);
    },
  });
});

afterEach(() => { act(() => resetPerformanceExperiments()); });

it.each(["One line", "First line\nSecond line\nThird line"])("keeps shimmer and static text metrics identical: %s", (text) => {
  const result = render(<PerformanceExperimentProvider>
    <WaveText text={text} style={typeScale.body} numberOfLines={0} />
  </PerformanceExperimentProvider>);
  const measured = result.getByText(text, { includeHiddenElements: true });
  const animatedStyle = StyleSheet.flatten(measured.props.style);
  expect(animatedStyle).toMatchObject({ includeFontPadding: false, fontSize: typeScale.body.fontSize,
    lineHeight: typeScale.body.lineHeight, opacity: 0 });
  expect(measured.props.numberOfLines).toBe(0);
  expect(result.getByTestId("active-text-shimmer")).not.toHaveStyle({ paddingVertical: expect.any(Number) });

  act(() => setPerformanceExperiment("disableTextShimmer", true));
  const fallback = result.getByText(text);
  const fallbackStyle = StyleSheet.flatten(fallback.props.style);
  expect(fallbackStyle).toMatchObject({ includeFontPadding: false, fontSize: animatedStyle.fontSize,
    lineHeight: animatedStyle.lineHeight, fontFamily: animatedStyle.fontFamily });
  expect(fallbackStyle.opacity).toBeUndefined();
  expect(fallback.props.numberOfLines).toBe(0);
});

it("keeps the collapsed line limit when reduced motion replaces the native shimmer", () => {
  const result = render(<PerformanceExperimentProvider>
    <WaveText text="A long pending message" style={typeScale.body} numberOfLines={6} />
  </PerformanceExperimentProvider>);
  expect(result.getByText("A long pending message", { includeHiddenElements: true }).props.numberOfLines).toBe(6);
  act(() => setPerformanceExperiment("reduceCustomMotion", true));
  expect(result.getByText("A long pending message").props.numberOfLines).toBe(6);
  expect(result.getByText("A long pending message")).toHaveStyle({ includeFontPadding: false });
});
