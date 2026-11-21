import { useState, type ReactNode } from "react";
import { StyleSheet, Text, View, type LayoutChangeEvent } from "react-native";

import { colors, spacing, typeScale, typeWeight } from "../theme";
import { productFonts } from "../ui/product-fonts";
import { APP_MAX_FONT_SIZE_MULTIPLIER } from "../ui/typography-policy";
import { useConstant } from "../react/useConstant";
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
  const tokens = props.tokens !== null && props.tokens !== undefined;
  const cost = props.cost !== null && props.cost !== undefined;
  const changes = props.changes !== null && props.changes !== undefined;
  const time = props.time !== null;
  const { dimensions, layout } = useFooterDimensions();
  const width = dimensions.row ?? 0;
  const widths = dimensions;
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
  return (
    <View style={styles.frame}>
      {measured && (
        <View accessible={false} style={[styles.intrinsicWidth, { width: totalWidth }]} />
      )}
      <View onLayout={layout.row} style={styles.row} testID="turn-footer">
        <View onLayout={layout.primary} style={styles.metadata} testID="turn-footer-metadata">
          {props.children}
        </View>
        {tokens && (
          <FooterPartView onLayout={layout.tokens} part="tokens" visible={showTokens}>
            <FooterSeparator />
            {props.tokens}
          </FooterPartView>
        )}
        {cost && (
          <FooterPartView onLayout={layout.cost} part="cost" visible={showCost}>
            <FooterSeparator />
            {props.cost}
          </FooterPartView>
        )}
        {changes && (
          <FooterPartView onLayout={layout.changes} part="changes" visible>
            <FooterSeparator />
            {props.changes}
          </FooterPartView>
        )}
        {time && (
          <View style={styles.alignEnd} testID="turn-footer-time-anchor">
            <Text
              maxFontSizeMultiplier={APP_MAX_FONT_SIZE_MULTIPLIER}
              numberOfLines={1}
              onLayout={layout.time}
              style={styles.time}
              testID="turn-footer-time"
            >
              {props.time}
            </Text>
          </View>
        )}
      </View>
    </View>
  );
}

type FooterMeasure = FooterPart | "row";
type Dimensions = Record<FooterMeasure, number | null>;
const EMPTY_DIMENSIONS: Dimensions = {
  changes: null,
  cost: null,
  primary: null,
  row: null,
  time: null,
  tokens: null,
};

/** All native segments report through one stable set of handlers. */
function useFooterDimensions() {
  const [dimensions, setDimensions] = useState<Dimensions>(EMPTY_DIMENSIONS);
  const measure = useEvent((part: FooterMeasure, width: number) => {
    setDimensions((current) => (current[part] === width ? current : { ...current, [part]: width }));
  });
  const layout = useConstant(() => {
    const handler = (part: FooterMeasure) => (event: LayoutChangeEvent) => {
      measure(part, event.nativeEvent.layout.width);
    };
    return {
      changes: handler("changes"),
      cost: handler("cost"),
      primary: handler("primary"),
      row: handler("row"),
      time: handler("time"),
      tokens: handler("tokens"),
    };
  });
  return { dimensions, layout };
}

function FooterPartView({
  children,
  onLayout,
  part,
  visible,
}: {
  children: ReactNode;
  onLayout: (event: LayoutChangeEvent) => void;
  part: FooterPart;
  visible: boolean;
}) {
  // Keep a single mounted instance measurable when hidden, so widening restores it
  // and popovers/animated values never require a duplicate measurement tree.
  return (
    <View
      accessibilityElementsHidden={!visible}
      importantForAccessibility={visible ? "auto" : "no-hide-descendants"}
      onLayout={onLayout}
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
  frame: {
    alignSelf: "stretch",
    maxWidth: "100%",
    minWidth: 0,
  },
  hidden: {
    opacity: 0,
    position: "absolute",
    zIndex: -1,
  },
  // Contribute the natural width without forcing the parent wider than its available space.
  intrinsicWidth: {
    height: 0,
    maxWidth: "100%",
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
