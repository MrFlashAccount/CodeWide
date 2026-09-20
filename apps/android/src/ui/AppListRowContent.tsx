import { Ionicons } from "@expo/vector-icons";
import { ActivityIndicator, Pressable, StyleSheet, View } from "react-native";
import { useEvent } from "../react/useEvent";
import { colors, controlSize, iconSize, radii, spacing } from "../theme";
import { AppText } from "./Typography";
import { listRowStyles as styles } from "./AppListRow.styles";
import { listRowHeight, type AppListRowProps } from "./AppListRow.types";

const PRESSED_OPACITY = 0.6;

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
  selectionIndicator: {
    alignItems: "center",
    justifyContent: "center",
    width: iconSize.inline,
  },
  titleIndicator: {
    borderRadius: radii.pill,
    flexShrink: 0,
  },
  titleRow: {
    alignItems: "center",
    flexDirection: "row",
    gap: spacing.xs,
    minWidth: 0,
  },
  trailingAction: {
    alignItems: "center",
    height: controlSize.regular,
    justifyContent: "center",
    width: controlSize.regular,
  },
  trailingActionPressed: { opacity: PRESSED_OPACITY },
});

function AppListRowTrailingAction({
  action,
}: {
  readonly action: NonNullable<AppListRowProps["trailingAction"]>;
}): React.JSX.Element {
  const press = useEvent(() => {
    if (action.visible && !action.busy) {
      action.onPress();
    }
  });
  if (!action.visible) {
    return <View style={contentStyles.trailingAction} />;
  }
  return (
    <Pressable
      accessibilityLabel={action.accessibilityLabel}
      accessibilityRole="button"
      accessibilityState={{ busy: action.busy, disabled: action.busy }}
      disabled={action.busy}
      hitSlop={spacing.xs}
      onPress={press}
      style={({ pressed }) => [
        contentStyles.trailingAction,
        pressed && contentStyles.trailingActionPressed,
      ]}
    >
      {action.busy ? (
        <ActivityIndicator color={colors.text} size="small" />
      ) : (
        <Ionicons
          color={action.icon.color ?? colors.text}
          name={action.icon.name}
          size={action.icon.size ?? iconSize.action}
        />
      )}
    </Pressable>
  );
}

/** RN owns the entire row when accessories contain custom React content. */
export function AppListRowContent(props: AppListRowProps) {
  const position = props.position ?? "only";
  const hasSecondaryAction = props.trailing !== undefined || props.trailingAction !== undefined;
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
            ...(props.expanded === undefined ? {} : { expanded: props.expanded }),
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
            <View style={contentStyles.titleRow}>
              {props.titleIndicator !== undefined && (
                <View
                  style={[
                    contentStyles.titleIndicator,
                    {
                      backgroundColor: props.titleIndicator.color,
                      height: props.titleIndicator.size,
                      width: props.titleIndicator.size,
                    },
                  ]}
                  testID={props.titleIndicator.testID}
                />
              )}
              <AppText
                numberOfLines={props.multiline === true ? 2 : 1}
                style={[styles.title, props.danger === true && styles.danger]}
              >
                {props.title}
              </AppText>
            </View>
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
          {!hasSecondaryAction && (
            <View
              style={[
                styles.slot,
                props.selected === undefined ? undefined : contentStyles.selectionIndicator,
              ]}
            >
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
        {hasSecondaryAction && (
          // Sibling actions remain separate accessibility targets instead of
          // being grouped into the primary Pressable's labelled native view.
          <View style={[styles.slot, contentStyles.secondary]}>
            {props.trailing}
            {props.trailingAction !== undefined && (
              <AppListRowTrailingAction action={props.trailingAction} />
            )}
            {props.selected !== undefined && (
              <View style={contentStyles.selectionIndicator}>
                {props.selected && (
                  <Ionicons color={colors.text} name="checkmark" size={iconSize.inline} />
                )}
              </View>
            )}
          </View>
        )}
      </View>
      {(position === "first" || position === "middle") && <View style={styles.separator} />}
    </View>
  );
}
