import { Ionicons } from "@expo/vector-icons";
import type { ReactNode } from "react";
import { Pressable, StyleSheet, View, type TextStyle } from "react-native";

import { colors, controlSize, iconSize, spacing, typeScale } from "../../../theme";
import { AppText as Text } from "../../../ui/Typography";
import type { MergeBoxTone } from "../overview/mergeBox";
import { STATUS_TEXT_INSET } from "./statusLayout";

/** Whether the row can open, and if so whether it is open. */
type Disclosure =
  | { readonly kind: "fixed" }
  | { readonly expanded: boolean; readonly kind: "expandable"; readonly onToggle: () => void };

/** One Status row: a toned glyph, the fact, the reason and, when it opens, what lies below. */
type StatusRowProps = {
  /** Shown below the text while the row is fixed or expanded. */
  readonly children?: ReactNode;
  readonly detail: string;
  /** `alert` paints the reason in the tone's color, for a fact that blocks merging. */
  readonly detailTone: "alert" | "muted";
  readonly disclosure: Disclosure;
  /** Draws the inset hairline that separates it from the row above. */
  readonly divided: boolean;
  readonly testID: string;
  readonly title: string;
  readonly tone: MergeBoxTone;
};

/**
 * A full-width Status row, GitHub Mobile style: the status glyph in its
 * semantic color, the title and a second line, a chevron when it expands,
 * and its children aligned under the text. Color always pairs with the words.
 */
export function StatusRow(props: StatusRowProps): React.JSX.Element {
  const { disclosure } = props;
  const open = disclosure.kind === "fixed" || disclosure.expanded;
  const children =
    open && props.children !== undefined ? (
      <View style={styles.children}>{props.children}</View>
    ) : null;
  return (
    <View testID={props.testID}>
      {props.divided ? <View style={styles.divider} /> : null}
      {disclosure.kind === "fixed" ? (
        <View style={styles.head}>
          <RowContent {...props} expanded={null} />
        </View>
      ) : (
        <Pressable
          accessibilityLabel={`${props.title}. ${props.detail}`}
          accessibilityRole="button"
          accessibilityState={{ expanded: disclosure.expanded }}
          onPress={disclosure.onToggle}
          style={({ pressed }) => [styles.head, pressed && styles.pressed]}
          testID={`${props.testID}-toggle`}
        >
          <RowContent {...props} expanded={disclosure.expanded} />
        </Pressable>
      )}
      {children}
    </View>
  );
}

/** The glyph, the two lines of text and, for an expandable row, its chevron. */
function RowContent(
  props: StatusRowProps & { readonly expanded: boolean | null },
): React.JSX.Element {
  const tone = TONES[props.tone];
  const detail = (
    <Text
      style={[styles.detail, props.detailTone === "alert" && tone.alert]}
      testID={`${props.testID}-detail`}
    >
      {props.detail}
    </Text>
  );
  return (
    <>
      <Ionicons color={tone.color} name={tone.icon} size={iconSize.action} />
      <View style={styles.text}>
        <Text style={styles.title}>{props.title}</Text>
        {detail}
      </View>
      {props.expanded === null ? null : (
        <Ionicons
          color={colors.textMuted}
          name={props.expanded ? "chevron-up" : "chevron-down"}
          size={iconSize.action}
        />
      )}
    </>
  );
}

const styles = StyleSheet.create({
  children: {
    gap: spacing.sm,
    paddingBottom: spacing.sm,
    paddingLeft: STATUS_TEXT_INSET,
    paddingRight: spacing.md,
  },
  detail: {
    ...typeScale.label,
    color: colors.textMuted,
  },
  detailDanger: {
    color: colors.error,
  },
  detailNeutral: {
    color: colors.textMuted,
  },
  detailSuccess: {
    color: colors.success,
  },
  detailWarning: {
    color: colors.warning,
  },
  // The hairline starts at the text, as GitHub Mobile insets its list dividers.
  divider: {
    backgroundColor: colors.borderSoft,
    height: StyleSheet.hairlineWidth,
    marginLeft: STATUS_TEXT_INSET,
  },
  head: {
    alignItems: "center",
    columnGap: spacing.md,
    flexDirection: "row",
    minHeight: controlSize.touch + spacing.xxs,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
  },
  pressed: {
    backgroundColor: colors.surfaceContainer,
  },
  text: {
    flex: 1,
    gap: spacing.optical,
    minWidth: 0,
  },
  title: {
    ...typeScale.body,
    color: colors.text,
  },
});

const TONES: Readonly<
  Record<
    MergeBoxTone,
    {
      readonly alert: TextStyle;
      readonly color: string;
      readonly icon: "alert-circle" | "checkmark-circle" | "close-circle" | "ellipse-outline";
    }
  >
> = {
  danger: { alert: styles.detailDanger, color: colors.error, icon: "close-circle" },
  neutral: { alert: styles.detailNeutral, color: colors.textMuted, icon: "ellipse-outline" },
  success: { alert: styles.detailSuccess, color: colors.success, icon: "checkmark-circle" },
  warning: { alert: styles.detailWarning, color: colors.warning, icon: "alert-circle" },
};
