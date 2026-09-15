import { useState, type ReactNode } from "react";
import { StyleSheet, Text, View, type LayoutChangeEvent } from "react-native";

import { colors, spacing, typeScale, typeWeight } from "../theme";
import { productFonts } from "../ui/product-fonts";
import { APP_MAX_FONT_SIZE_MULTIPLIER } from "../ui/typography-policy";
import { useEvent } from "../react/useEvent";

interface MessageFooterRowProps {
  readonly time: string | null;
  readonly children: ReactNode;
  readonly tokens?: ReactNode;
  readonly cost?: ReactNode;
  readonly changes?: ReactNode;
}

/** Status remains one indivisible group at every available width. */
export function MessageFooterStatus(props: { children: ReactNode }) {
  return (
    <View testID="turn-footer-status" style={styles.status}>
      {props.children}
    </View>
  );
}

type FooterPart = "primary" | "tokens" | "cost" | "changes" | "time";

/** Preserve status/time and Changes; shed tokens, then cost, instead of wrapping. */
export function MessageFooterRow(props: MessageFooterRowProps) {
  const [width, setWidth] = useState(0);
  const [widths, setWidths] = useState<Record<FooterPart, number | null>>({
    primary: null,
    tokens: null,
    cost: null,
    changes: null,
    time: null,
  });
  const measure = useEvent((part: FooterPart, measured: number) => {
    setWidths((current) =>
      current[part] === measured ? current : { ...current, [part]: measured },
    );
  });
  const layout = useEvent((event: LayoutChangeEvent) => setWidth(event.nativeEvent.layout.width));
  const tokens = props.tokens != null;
  const cost = props.cost != null;
  const changes = props.changes != null;
  const time = props.time !== null;
  const measured =
    widths.primary !== null &&
    (!tokens || widths.tokens !== null) &&
    (!cost || widths.cost !== null) &&
    (!changes || widths.changes !== null) &&
    (!time || widths.time !== null);
  const essentialWidth =
    (widths.primary ?? 0) + (changes ? (widths.changes ?? 0) : 0) + (time ? (widths.time ?? 0) : 0);
  const costWidth = cost ? (widths.cost ?? 0) : 0;
  const tokensWidth = tokens ? (widths.tokens ?? 0) : 0;
  const totalWidth = essentialWidth + costWidth + tokensWidth + spacing.sm * 2;
  const available = width - spacing.sm * 2;
  const showCost = !measured || width === 0 || essentialWidth + costWidth <= available;
  const showTokens = !measured || width === 0 || totalWidth <= width;
  const visibleWidth =
    essentialWidth + (showCost ? costWidth : 0) + (showTokens ? tokensWidth : 0) + spacing.sm * 2;
  return (
    <View
      testID="turn-footer"
      onLayout={layout}
      style={[styles.row, measured && { minWidth: visibleWidth }]}
    >
      <FooterPartView part="primary" visible onMeasure={measure}>
        <View testID="turn-footer-metadata" style={styles.metadata}>
          {props.children}
        </View>
      </FooterPartView>
      {tokens && (
        <FooterPartView part="tokens" visible={showTokens} onMeasure={measure}>
          <FooterSeparator />
          {props.tokens}
        </FooterPartView>
      )}
      {cost && (
        <FooterPartView part="cost" visible={showCost} onMeasure={measure}>
          <FooterSeparator />
          {props.cost}
        </FooterPartView>
      )}
      {changes && (
        <FooterPartView part="changes" visible onMeasure={measure}>
          <FooterSeparator />
          {props.changes}
        </FooterPartView>
      )}
      {time && (
        <View testID="turn-footer-time-anchor" style={styles.alignEnd}>
          <FooterPartView part="time" visible onMeasure={measure}>
            <Text
              testID="turn-footer-time"
              numberOfLines={1}
              maxFontSizeMultiplier={APP_MAX_FONT_SIZE_MULTIPLIER}
              style={styles.time}
            >
              {props.time}
            </Text>
          </FooterPartView>
        </View>
      )}
    </View>
  );
}

function FooterPartView({
  part,
  visible,
  onMeasure,
  children,
}: {
  part: FooterPart;
  visible: boolean;
  onMeasure(part: FooterPart, width: number): void;
  children: ReactNode;
}) {
  const layout = useEvent((event: LayoutChangeEvent) =>
    onMeasure(part, event.nativeEvent.layout.width),
  );
  // Keep a single mounted instance measurable when hidden, so widening restores it
  // and popovers/animated values never require a duplicate measurement tree.
  return (
    <View
      testID={`turn-footer-${part}-segment`}
      onLayout={layout}
      pointerEvents={visible ? "auto" : "none"}
      accessibilityElementsHidden={!visible}
      importantForAccessibility={visible ? "auto" : "no-hide-descendants"}
      style={[styles.part, !visible && styles.hidden]}
    >
      {children}
    </View>
  );
}

function FooterSeparator() {
  return (
    <Text accessible={false} numberOfLines={1} style={styles.separator}>
      ·
    </Text>
  );
}

const styles = StyleSheet.create({
  status: {
    flexDirection: "row",
    alignItems: "center",
    flexShrink: 0,
    gap: spacing.xxs,
  },
  row: {
    alignSelf: "stretch",
    minWidth: 0,
    maxWidth: "100%",
    flexShrink: 1,
    minHeight: typeScale.label.lineHeight,
    flexDirection: "row",
    flexWrap: "nowrap",
    alignItems: "center",
    paddingHorizontal: spacing.sm,
    paddingVertical: spacing.optical,
  },
  metadata: {
    flexShrink: 0,
    flexDirection: "row",
    flexWrap: "nowrap",
    alignItems: "center",
    gap: spacing.xxs,
  },
  part: {
    flexDirection: "row",
    flexShrink: 0,
    alignItems: "center",
  },
  alignEnd: {
    marginLeft: "auto",
    paddingLeft: spacing.sm,
  },
  hidden: {
    position: "absolute",
    opacity: 0,
    zIndex: -1,
  },
  separator: {
    color: colors.textDim,
    ...typeScale.caption,
    marginHorizontal: spacing.xs,
  },
  time: {
    flexShrink: 0,
    textAlign: "right",
    color: colors.textDim,
    ...typeScale.caption,
    fontFamily: productFonts.medium,
    fontWeight: typeWeight.regular,
    fontVariant: ["tabular-nums"],
  },
});
