import { Ionicons } from "@expo/vector-icons";
import type { ComponentProps } from "react";
import { Text, View, useWindowDimensions } from "react-native";

import { inlineIconMetrics, type InlineIconRole } from "./inline-icon-metrics";

/** Text-adjacent glyphs follow their label's scale; the parent owns the touch target. */
export function InlineIcon({
  role,
  ...props
}: Omit<ComponentProps<typeof Ionicons>, "role" | "size" | "allowFontScaling" | "style"> & {
  role: InlineIconRole;
}) {
  const { fontScale } = useWindowDimensions();
  const metrics = inlineIconMetrics(role, fontScale);
  return (
    <View
      style={{
        alignItems: "center",
        flexShrink: 0,
        height: metrics.slot,
        justifyContent: "center",
        width: metrics.slot,
      }}
      testID="inline-icon-slot"
    >
      <Ionicons
        {...props}
        allowFontScaling={false}
        size={metrics.glyph}
        style={{ includeFontPadding: false, lineHeight: metrics.glyph, textAlign: "center" }}
      />
    </View>
  );
}

/** Emoji use the same slot across fonts instead of contributing variable inline advance. */
export function InlineEmoji({ role, value }: { role: InlineIconRole; value: string }) {
  const { fontScale } = useWindowDimensions();
  const metrics = inlineIconMetrics(role, fontScale);
  return (
    <View
      style={{
        alignItems: "center",
        flexShrink: 0,
        height: metrics.slot,
        justifyContent: "center",
        width: metrics.slot,
      }}
      testID="inline-emoji-slot"
    >
      <Text
        allowFontScaling={false}
        style={{
          fontFamily: "sans-serif",
          fontSize: metrics.glyph,
          includeFontPadding: false,
          lineHeight: metrics.slot,
          textAlign: "center",
        }}
      >
        {value}
      </Text>
    </View>
  );
}
