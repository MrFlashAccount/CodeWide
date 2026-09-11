import { Ionicons } from "@expo/vector-icons";
import type { ComponentProps } from "react";
import { Text, View, useWindowDimensions } from "react-native";

import { inlineIconMetrics, type InlineIconRole } from "./inline-icon-metrics";

/** Text-adjacent glyphs follow their label's scale; the parent owns the touch target. */
export function InlineIcon({ role, ...props }: Omit<ComponentProps<typeof Ionicons>, "role" | "size" | "allowFontScaling" | "style"> & { role: InlineIconRole }) {
  const { fontScale } = useWindowDimensions();
  const metrics = inlineIconMetrics(role, fontScale);
  return (
    <View testID="inline-icon-slot" style={{ width: metrics.slot, height: metrics.slot, flexShrink: 0, alignItems: "center", justifyContent: "center" }}>
      <Ionicons {...props} size={metrics.glyph} allowFontScaling={false} style={{ includeFontPadding: false, lineHeight: metrics.glyph, textAlign: "center" }} />
    </View>
  );
}

/** Emoji use the same slot across fonts instead of contributing variable inline advance. */
export function InlineEmoji({ value, role }: { value: string; role: InlineIconRole }) {
  const { fontScale } = useWindowDimensions();
  const metrics = inlineIconMetrics(role, fontScale);
  return (
    <View testID="inline-emoji-slot" style={{ width: metrics.slot, height: metrics.slot, flexShrink: 0, alignItems: "center", justifyContent: "center" }}>
      <Text allowFontScaling={false} style={{ fontFamily: "sans-serif", fontSize: metrics.glyph, lineHeight: metrics.slot, includeFontPadding: false, textAlign: "center" }}>{value}</Text>
    </View>
  );
}
