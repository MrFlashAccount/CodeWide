import { useRef, type ComponentRef, type ReactElement } from "react";
import {
  processColor,
  requireNativeComponent,
  useWindowDimensions,
  type NativeSyntheticEvent,
  type ViewProps,
} from "react-native";
import { useEvent } from "../../../react/useEvent";
import { colors, spacing, typeScale } from "../../../theme";
import { formatEstimatedTurnCost } from "../../../turn-cost";
import { compactNumber } from "../../../ui/number-format";
import { productFonts } from "../../../ui/product-fonts";
import { TOKEN_SYMBOL } from "../../../ui/token-display";
import { APP_MAX_FONT_SIZE_MULTIPLIER } from "../../../ui/typography-policy";
import { useCostBreakdownTrigger } from "../../accounts/useCostBreakdownTrigger";
import type { CompletedFooterProps } from "./CompletedFooter.types";
import { tokenUsageLabel } from "./tokenUsageLabel";

import { COMPLETED_FOOTER_NAME } from "./completedFooterSupport";

const STATUS_DOT_SIZE = 7;
const PRICE_HIT_SLOP = 5;
const VERTICAL_EDGES = 2;
type PriceBounds = Readonly<{ height: number; width: number; x: number }>;

const baseTheme = {
  dim: processColor(colors.textDim),
  dotGap: spacing.xxs,
  dotSize: STATUS_DOT_SIZE,
  font: productFonts.medium,
  inset: spacing.sm,
  muted: processColor(colors.textMuted),
  separatorGap: spacing.xs,
  success: processColor(colors.green),
  touchPadding: PRICE_HIT_SLOP,
};
type FooterContent = Readonly<
  Record<"status" | "duration" | "tokens" | "tokenLabel" | "price" | "priceLabel" | "time", string>
>;
const NativeFooter = requireNativeComponent<
  ViewProps & {
    footerContent: FooterContent;
    footerTheme: typeof baseTheme & { textSize: number };
    onFooterPricePress: (event: NativeSyntheticEvent<PriceBounds>) => void;
  }
>(COMPLETED_FOOTER_NAME);

/** The native leaf owns layout and accessibility. The shared popup owner retains cost interactions. */
export function CompletedFooter(props: CompletedFooterProps): ReactElement {
  const root = useRef<ComponentRef<typeof NativeFooter>>(null);
  const open = useCostBreakdownTrigger(props.estimate);
  const fontScale = Math.min(useWindowDimensions().fontScale, APP_MAX_FONT_SIZE_MULTIPLIER);
  const onPrice = useEvent((event: NativeSyntheticEvent<PriceBounds>) => {
    const { height, width, x } = event.nativeEvent;
    open((receive) => {
      root.current?.measureInWindow((left, top) => {
        receive({ height, left: left + x, top, width });
      });
    });
  });
  const price = formatEstimatedTurnCost(props.estimate.totalCostUsd);
  const basis =
    props.estimate.basis === "apiEquivalent"
      ? "Estimated API-equivalent cost"
      : "Cost estimated by the agent";
  return (
    <NativeFooter
      footerContent={{
        duration: props.duration,
        price: `≈${price}`,
        priceLabel: `${basis} ${price}`,
        status: "Completed",
        time: props.time,
        tokenLabel: tokenUsageLabel(props.input, props.output),
        tokens: `${TOKEN_SYMBOL} ↓${compactNumber(props.input)} ↑${compactNumber(props.output)}`,
      }}
      footerTheme={{ ...baseTheme, textSize: typeScale.caption.fontSize * fontScale }}
      onFooterPricePress={onPrice}
      ref={root}
      style={{
        alignSelf: "stretch",
        height: Math.max(
          typeScale.label.lineHeight,
          typeScale.caption.lineHeight * fontScale + spacing.optical * VERTICAL_EDGES,
        ),
      }}
      testID="turn-footer"
    />
  );
}
