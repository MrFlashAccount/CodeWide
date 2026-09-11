import { Ionicons } from "@expo/vector-icons";
import { ActivityIndicator, Pressable, StyleSheet, View } from "react-native";
import { colors, iconSize, spacing } from "../theme";
import { AppText } from "./Typography";
import { listRowStyles as styles } from "./AppListRow.styles";
import { listRowHeight, type AppListRowProps } from "./AppListRow.types";

const contentStyles = StyleSheet.create({
  actions: { flexDirection: "row", alignItems: "center" },
  primary: { flex: 1, minWidth: 0 },
  secondary: { paddingRight: spacing.md },
});

/** RN owns the entire row when accessories contain custom React content. */
export function AppListRowContent(props: AppListRowProps) {
  const position = props.position ?? "only";
  return (
    <View
      style={[
        styles.surface,
        styles[position],
        props.selected && styles.selected,
        props.disabled && styles.disabled,
      ]}
    >
      <View style={contentStyles.actions}>
        <Pressable
          testID={props.testID}
          accessible={props.onPress !== undefined}
          accessibilityRole={
            props.onPress === undefined
              ? undefined
              : props.selected === undefined
                ? "button"
                : "radio"
          }
          accessibilityLabel={props.accessibilityLabel ?? props.title}
          accessibilityHint={props.accessibilityHint}
          accessibilityState={{
            disabled: props.disabled ?? false,
            busy: props.trailingBusy === true,
            ...(props.selected === undefined ? {} : { checked: props.selected }),
          }}
          disabled={props.disabled || props.onPress === undefined}
          onPress={props.onPress}
          style={({ pressed }) => [
            styles.row,
            contentStyles.primary,
            { minHeight: props.description ? listRowHeight.double : listRowHeight.single },
            props.fixedHeight === undefined ? undefined : { height: props.fixedHeight },
            pressed && styles.pressed,
          ]}
        >
          {props.leading !== undefined && <View style={styles.slot}>{props.leading}</View>}
          {props.leadingIcon !== undefined && (
            <View style={styles.slot}>
              <Ionicons
                name={props.leadingIcon.name}
                size={props.leadingIcon.size ?? iconSize.inline}
                color={props.leadingIcon.color ?? colors.textMuted}
              />
            </View>
          )}
          <View style={styles.text}>
            <AppText
              numberOfLines={props.multiline ? 2 : 1}
              style={[styles.title, props.danger && styles.danger]}
            >
              {props.title}
            </AppText>
            {props.description !== undefined && props.description !== "" && (
              <View style={styles.supporting}>
                {props.descriptionLeading}
                {props.descriptionIcon !== undefined && (
                  <Ionicons
                    name={props.descriptionIcon.name}
                    size={props.descriptionIcon.size ?? iconSize.inline}
                    color={props.descriptionIcon.color ?? colors.textMuted}
                  />
                )}
                <AppText
                  numberOfLines={props.multiline ? 2 : 1}
                  style={[styles.description, styles.supportingText]}
                >
                  {props.description}
                </AppText>
              </View>
            )}
          </View>
          {props.trailing === undefined && (
            <View style={styles.slot}>
              {props.trailingIcon !== undefined && (
                <Ionicons
                  name={props.trailingIcon.name}
                  size={props.trailingIcon.size ?? iconSize.inline}
                  color={props.trailingIcon.color ?? colors.textMuted}
                />
              )}
              {props.trailingBusy === true && (
                <ActivityIndicator size="small" color={colors.textMuted} />
              )}
              {props.selected === true && (
                <Ionicons name="checkmark" size={iconSize.inline} color={colors.text} />
              )}
            </View>
          )}
        </Pressable>
        {props.trailing !== undefined && (
          // Sibling actions remain separate accessibility targets instead of
          // being grouped into the primary Pressable's labelled native view.
          <View style={[styles.slot, contentStyles.secondary]}>
            {props.trailing}
            {props.selected === true && (
              <Ionicons name="checkmark" size={iconSize.inline} color={colors.text} />
            )}
          </View>
        )}
      </View>
      {(position === "first" || position === "middle") && <View style={styles.separator} />}
    </View>
  );
}
