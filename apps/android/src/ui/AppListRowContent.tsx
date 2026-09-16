import { Ionicons } from "@expo/vector-icons";
import { ActivityIndicator, Pressable, StyleSheet, View } from "react-native";
import { colors, iconSize, spacing } from "../theme";
import { AppText } from "./Typography";
import { listRowStyles as styles } from "./AppListRow.styles";
import { listRowHeight, type AppListRowProps } from "./AppListRow.types";

const contentStyles = StyleSheet.create({
  actions: {
    alignItems: "center",
    flexDirection: "row",
  },
  primary: {
    flex: 1,
    minWidth: 0,
  },
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
        props.selected === true && styles.selected,
        props.disabled === true && styles.disabled,
      ]}
    >
      <View style={contentStyles.actions}>
        <Pressable
          accessibilityHint={props.accessibilityHint}
          accessibilityLabel={props.accessibilityLabel ?? props.title}
          accessibilityRole={
            props.onPress === undefined
              ? undefined
              : props.selected === undefined
                ? "button"
                : "radio"
          }
          accessibilityState={{
            busy: props.trailingBusy === true,
            disabled: props.disabled ?? false,
            ...(props.selected === undefined ? {} : { checked: props.selected }),
          }}
          accessible={props.onPress !== undefined}
          disabled={props.disabled === true || props.onPress === undefined}
          onPress={props.onPress}
          style={({ pressed }) => [
            styles.row,
            contentStyles.primary,
            {
              minHeight:
                props.description === undefined || props.description === ""
                  ? listRowHeight.single
                  : listRowHeight.double,
            },
            props.fixedHeight === undefined ? undefined : { height: props.fixedHeight },
            pressed && styles.pressed,
          ]}
          testID={props.testID}
        >
          {props.leading !== undefined && <View style={styles.slot}>{props.leading}</View>}
          {props.leadingIcon !== undefined && (
            <View style={styles.slot}>
              <Ionicons
                color={props.leadingIcon.color ?? colors.textMuted}
                name={props.leadingIcon.name}
                size={props.leadingIcon.size ?? iconSize.inline}
              />
            </View>
          )}
          <View style={styles.text}>
            <AppText
              numberOfLines={props.multiline === true ? 2 : 1}
              style={[styles.title, props.danger === true && styles.danger]}
            >
              {props.title}
            </AppText>
            {props.description !== undefined && props.description !== "" && (
              <View style={styles.supporting}>
                {props.descriptionLeading}
                {props.descriptionIcon !== undefined && (
                  <Ionicons
                    color={props.descriptionIcon.color ?? colors.textMuted}
                    name={props.descriptionIcon.name}
                    size={props.descriptionIcon.size ?? iconSize.inline}
                  />
                )}
                <AppText
                  numberOfLines={props.multiline === true ? 2 : 1}
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
                  color={props.trailingIcon.color ?? colors.textMuted}
                  name={props.trailingIcon.name}
                  size={props.trailingIcon.size ?? iconSize.inline}
                />
              )}
              {props.trailingBusy === true && (
                <ActivityIndicator color={colors.textMuted} size="small" />
              )}
              {props.selected === true && (
                <Ionicons color={colors.text} name="checkmark" size={iconSize.inline} />
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
              <Ionicons color={colors.text} name="checkmark" size={iconSize.inline} />
            )}
          </View>
        )}
      </View>
      {(position === "first" || position === "middle") && <View style={styles.separator} />}
    </View>
  );
}
