import { act, render } from "@testing-library/react-native";
import { Dimensions } from "react-native";
import { InlineEmoji, InlineIcon } from "../src/ui/InlineIcon";
import { inlineIconMetrics } from "../src/ui/inline-icon-metrics";

it("updates glyph and slot together when Android font scaling changes", () => {
  const initial = Dimensions.get("window");
  const result = render(<InlineIcon role="label" name="terminal-outline" color="#ffffff" testID="glyph" />);
  try {
    for (const fontScale of [0.85, 1, 1.3, 2]) {
      act(() => Dimensions.set({ window: { ...initial, fontScale }, screen: Dimensions.get("screen") }));
      const metrics = inlineIconMetrics("label", fontScale);
      const glyph = result.getByTestId("glyph");
      expect(glyph).toHaveStyle({ fontSize: metrics.glyph, lineHeight: metrics.glyph });
      expect(glyph.props.allowFontScaling).toBe(false);
      expect(result.getByTestId("inline-icon-slot")).toHaveStyle({ width: metrics.slot, height: metrics.slot, flexShrink: 0 });
    }
  } finally {
    act(() => Dimensions.set({ window: initial, screen: Dimensions.get("screen") }));
  }
});

it("reserves the same title slot for differently shaped emoji", () => {
  const result = render(<InlineEmoji role="body" value="📌" />);
  const metrics = inlineIconMetrics("body", Dimensions.get("window").fontScale);
  for (const value of ["📌", "📎", "🔍", "🧹"]) {
    result.rerender(<InlineEmoji role="body" value={value} />);
    expect(result.getByText(value)).toBeVisible();
    expect(result.getByTestId("inline-emoji-slot")).toHaveStyle({ width: metrics.slot, height: metrics.slot });
  }
});
