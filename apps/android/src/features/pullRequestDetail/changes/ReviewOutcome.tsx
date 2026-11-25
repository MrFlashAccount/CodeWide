import { Linking, StyleSheet, View } from "react-native";

import { safeProviderUrl } from "../../../data/forgeProviderUrl";
import { colors, controlSize, spacing, typeScale } from "../../../theme";
import { AppText as Text } from "../../../ui/Typography";
import { publishedDetail, publishedTitle } from "./submitResultCopy";

/** The most recent acknowledged publication, retained if a later attempt fails. */
export type SubmitResult =
  | { readonly kind: "verdict"; readonly reviewUrl: string | null; readonly verdict: string }
  | {
      readonly kind: "published";
      readonly left: number;
      readonly published: number;
      readonly reviewUrl: string | null;
      readonly toAgent: number;
      readonly verdict: string;
    };

/**
 * One slim line under the Changes toolbar reporting the last Submit instead of
 * a toast: what was published (with the forge's review page when it is an
 * https page on the account host) after a successful submission.
 */
export function ReviewOutcome({
  host,
  result,
}: {
  readonly host: string;
  readonly result: SubmitResult;
}): React.JSX.Element {
  const reviewUrl = result.reviewUrl === null ? null : safeProviderUrl(result.reviewUrl, host);
  return (
    <View style={styles.row} testID="review-dock-outcome">
      <Text numberOfLines={1} style={styles.text}>
        <Text style={styles.title}>{publishedTitle(result.verdict, host)}</Text>
        {result.kind === "published" ? ` · ${publishedDetail(result)}` : null}
      </Text>
      {reviewUrl === null ? null : (
        <Text
          accessibilityRole="link"
          onPress={() => {
            // Without a browser the outcome stays readable in place.
            Linking.openURL(reviewUrl).catch(() => undefined);
          }}
          style={styles.link}
        >
          View on forge
        </Text>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  link: {
    ...typeScale.label,
    color: colors.primary,
    paddingVertical: spacing.xxs,
  },
  row: {
    alignItems: "center",
    backgroundColor: colors.surfaceContainer,
    borderBottomColor: colors.borderSoft,
    borderBottomWidth: StyleSheet.hairlineWidth,
    columnGap: spacing.sm,
    flexDirection: "row",
    minHeight: controlSize.compact,
    paddingHorizontal: spacing.sm,
  },
  text: {
    ...typeScale.label,
    color: colors.textMuted,
    flex: 1,
  },
  title: {
    color: colors.text,
  },
});
