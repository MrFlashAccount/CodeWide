import { render } from "@testing-library/react-native";
import { StyleSheet, Text } from "react-native";

import { AnimatedNumber } from "../src/ui/AnimatedNumber.native";
import { APP_MAX_FONT_SIZE_MULTIPLIER } from "../src/ui/typography-policy";

jest.mock("../src/ui/Typography", () => jest.requireActual("../src/ui/AppText"));

it.each(["Changes · ", "Attachments · ", "Ports · "])(
  "%s keeps native drawing and measured text on the same typography contract",
  (prefix) => {
    const screen = render(
      <AnimatedNumber prefix={prefix} value={1124} style={{ fontSize: 11, lineHeight: 16 }} />,
    );
    const measured = screen.UNSAFE_getByType(Text);
    const native = screen.UNSAFE_getByProps({ numberAccessibilityLabel: `${prefix}1,124` });
    expect(measured.props.maxFontSizeMultiplier).toBe(APP_MAX_FONT_SIZE_MULTIPLIER);
    expect(native.props.maxFontSizeMultiplier).toBe(measured.props.maxFontSizeMultiplier);
    expect(StyleSheet.flatten(measured.props.style).fontVariant).toEqual(["tabular-nums"]);
    expect(native.props.fontSize).toBe(11);
    expect(screen.getByRole("text", { name: `${prefix}1,124` })).toBeVisible();
  },
);
