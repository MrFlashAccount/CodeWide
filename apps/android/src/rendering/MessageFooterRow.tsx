import { useState, type ReactNode } from "react";
import { StyleSheet, Text, View, type LayoutChangeEvent } from "react-native";

import { colors, spacing, typeScale, typeWeight } from "../theme";
import { productFonts } from "../ui/product-fonts";
import { APP_MAX_FONT_SIZE_MULTIPLIER } from "../ui/typography-policy";
import { useEvent } from "../react/useEvent";

interface MessageFooterRowProps {
  readonly changes?: ReactNode;
  readonly children: ReactNode;
  readonly cost?: ReactNode;
  readonly time: string | null;
  readonly tokens?: ReactNode;
}

/** Status remains one indivisible group at every available width. */
export function MessageFooterStatus(props: { children: ReactNode }) {
  return (
    <View style={styles.status} testID="turn-footer-status">
      {props.children}
    </View>
  );
}

type FooterPart = "primary" | "tokens" | "cost" | "changes" | "time";

/** Preserve status/time and Changes; shed tokens, then cost, instead of wrapping. */
export function MessageFooterRow(props: MessageFooterRowProps) {
  const [width, setWidth] = useState(0);
  const [widths, setWidths] = useState<Record<FooterPart, number | null>>({
    changes: null,
    cost: null,
    primary: null,
    time: null,
    tokens: null,
  });
  const measure = useEvent((part: FooterPart, measured: number) => {
    setWidths((current) =>
      current[part] === measured ? current : { ...current, [part]: measured },
    );
  });
  const layout = useEvent((event: LayoutChangeEvent) => {
    setWidth(event.nativeEvent.layout.width);
  });
  const tokens = props.tokens !== null && props.tokens !== undefined;
  const cost = props.cost !== null && props.cost !== undefined;
  const changes = props.changes !== null && props.changes !== undefined;
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
      onLayout={layout}
      style={[styles.row, measured && { minWidth: visibleWidth }]}
      testID="turn-footer"
    >
      <FooterPartView onMeasure={measure} part="primary" visible>
        <View style={styles.metadata} testID="turn-footer-metadata">
          {props.children}
        </View>
      </FooterPartView>
      {tokens && (
        <FooterPartView onMeasure={measure} part="tokens" visible={showTokens}>
          <FooterSeparator />
          {props.tokens}
        </FooterPartView>
      )}
      {cost && (
        <FooterPartView onMeasure={measure} part="cost" visible={showCost}>
          <FooterSeparator />
          {props.cost}
        </FooterPartView>
      )}
      {changes && (
        <FooterPartView onMeasure={measure} part="changes" visible>
          <FooterSeparator />
          {props.changes}
        </FooterPartView>
      )}
      {time && (
        <View style={styles.alignEnd} testID="turn-footer-time-anchor">
          <FooterPartView onMeasure={measure} part="time" visible>
            <Text
              maxFontSizeMultiplier={APP_MAX_FONT_SIZE_MULTIPLIER}
              numberOfLines={1}
              style={styles.time}
              testID="turn-footer-time"
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
  children,
  onMeasure,
  part,
  visible,
}: {
  children: ReactNode;
  onMeasure: (part: FooterPart, width: number) => void;
  part: FooterPart;
  visible: boolean;
}) {
  const layout = useEvent((event: LayoutChangeEvent) => {
    onMeasure(part, event.nativeEvent.layout.width);
  });
  // Keep a single mounted instance measurable when hidden, so widening restores it
  // and popovers/animated values never require a duplicate measurement tree.
  return (
    <View
      accessibilityElementsHidden={!visible}
      importantForAccessibility={visible ? "auto" : "no-hide-descendants"}
      onLayout={layout}
      pointerEvents={visible ? "auto" : "none"}
      style={[styles.part, !visible && styles.hidden]}
      testID={`turn-footer-${part}-segment`}
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
  alignEnd: {
    marginLeft: "auto",
    paddingLeft: spacing.sm,
  },
  hidden: {
    opacity: 0,
    position: "absolute",
    zIndex: -1,
  },
  metadata: {
    alignItems: "center",
    flexDirection: "row",
    flexShrink: 0,
    flexWrap: "nowrap",
    gap: spacing.xxs,
  },
  part: {
    alignItems: "center",
    flexDirection: "row",
    flexShrink: 0,
  },
  row: {
    alignItems: "center",
    alignSelf: "stretch",
    flexDirection: "row",
    flexShrink: 1,
    flexWrap: "nowrap",
    maxWidth: "100%",
    minHeight: typeScale.label.lineHeight,
    minWidth: 0,
    paddingHorizontal: spacing.sm,
    paddingVertical: spacing.optical,
  },
  separator: {
    color: colors.textDim,
    ...typeScale.caption,
    marginHorizontal: spacing.xs,
  },
  status: {
    alignItems: "center",
    flexDirection: "row",
    flexShrink: 0,
    gap: spacing.xxs,
  },
  time: {
    color: colors.textDim,
    flexShrink: 0,
    textAlign: "right",
    ...typeScale.caption,
    fontFamily: productFonts.medium,
    fontVariant: ["tabular-nums"],
    fontWeight: typeWeight.regular,
  },
});
