import { CircularProgressIndicator, Host, ListItem, Row, Text } from "@expo/ui/jetpack-compose";
import {
  clickable,
  clip,
  fillMaxWidth,
  height,
  Shapes,
  size,
  weight,
} from "@expo/ui/jetpack-compose/modifiers";
import { View } from "react-native";
import { useEvent } from "../react/useEvent";
import { ComposeNamedIcon } from "../presentation/icons/ComposeNamedIcon";
import { colors, iconSize, radii, spacing, typeScale } from "../theme";
import { listRowStyles as styles } from "./AppListRow.styles";
import type { AppListRowProps } from "./AppListRow.types";
import { AppListRowContent } from "./AppListRowContent";

/** Keep each row in one UI runtime, including independently interactive accessories. */
export function AppListRow(props: AppListRowProps) {
  if (
    props.leading !== undefined ||
    props.descriptionLeading !== undefined ||
    props.trailing !== undefined
  ) {
    return <AppListRowContent {...props} />;
  }
  return <ComposeListRow {...props} />;
}

function ComposeListRow(props: AppListRowProps) {
  const press = useEvent(() => {
    if (!props.disabled) props.onPress?.();
  });
  const position = props.position ?? "only";
  const modifiers = [fillMaxWidth()];
  if (position === "only") modifiers.push(clip(Shapes.RoundedCorner(radii.medium)));
  else if (position === "first") {
    modifiers.push(clip(Shapes.RoundedCorner({ topStart: radii.medium, topEnd: radii.medium })));
  } else if (position === "last") {
    modifiers.push(
      clip(Shapes.RoundedCorner({ bottomStart: radii.medium, bottomEnd: radii.medium })),
    );
  }
  if (props.fixedHeight !== undefined) modifiers.push(height(props.fixedHeight));
  if (props.onPress !== undefined && !props.disabled) modifiers.push(clickable(press));
  return (
    <View
      testID={props.testID}
      style={[
        styles.surface,
        styles[position],
        props.fixedHeight === undefined ? undefined : { height: props.fixedHeight },
        props.disabled && styles.disabled,
      ]}
      accessible={props.onPress !== undefined && props.trailing === undefined}
      accessibilityRole={
        props.onPress === undefined ? undefined : props.selected === undefined ? "button" : "radio"
      }
      accessibilityLabel={props.accessibilityLabel ?? props.title}
      accessibilityHint={props.accessibilityHint}
      accessibilityState={{
        disabled: props.disabled ?? false,
        busy: props.trailingBusy === true,
        ...(props.selected === undefined ? {} : { checked: props.selected }),
      }}
      onAccessibilityTap={press}
    >
      <Host
        colorScheme="dark"
        matchContents={{ vertical: props.fixedHeight === undefined }}
        style={{
          width: "100%",
          ...(props.fixedHeight === undefined ? {} : { height: props.fixedHeight }),
        }}
      >
        <ListItem
          modifiers={modifiers}
          colors={{
            containerColor: props.selected ? colors.surfaceContainerHigh : colors.surfaceContainer,
            contentColor: props.danger ? colors.red : colors.text,
            supportingContentColor: colors.textMuted,
          }}
        >
          {props.leadingIcon !== undefined && (
            <ListItem.LeadingContent>
              <ComposeNamedIcon
                name={props.leadingIcon.name}
                size={props.leadingIcon.size ?? iconSize.inline}
                color={props.leadingIcon.color ?? colors.textMuted}
              />
            </ListItem.LeadingContent>
          )}
          <ListItem.HeadlineContent>
            <Text
              maxLines={props.multiline ? 2 : 1}
              overflow="ellipsis"
              style={{
                fontSize: typeScale.body.fontSize,
                lineHeight: typeScale.body.lineHeight,
                fontFamily: "RobotoFlex-Regular",
              }}
            >
              {props.title}
            </Text>
          </ListItem.HeadlineContent>
          {props.description !== undefined && props.description !== "" && (
            <ListItem.SupportingContent>
              <Row verticalAlignment="center" horizontalArrangement={{ spacedBy: spacing.xxs }}>
                {props.descriptionIcon !== undefined && (
                  <ComposeNamedIcon
                    name={props.descriptionIcon.name}
                    size={props.descriptionIcon.size ?? iconSize.inline}
                    color={props.descriptionIcon.color ?? colors.textMuted}
                  />
                )}
                <Text
                  modifiers={[weight(1)]}
                  maxLines={props.multiline ? 2 : 1}
                  overflow="ellipsis"
                  style={{
                    fontSize: typeScale.label.fontSize,
                    lineHeight: typeScale.label.lineHeight,
                    fontFamily: "RobotoFlex-Regular",
                  }}
                >
                  {props.description}
                </Text>
              </Row>
            </ListItem.SupportingContent>
          )}
          {(props.trailing !== undefined ||
            props.trailingIcon !== undefined ||
            props.trailingBusy === true ||
            props.selected === true) && (
            <ListItem.TrailingContent>
              <Row verticalAlignment="center" horizontalArrangement={{ spacedBy: spacing.xs }}>
                {props.trailingIcon !== undefined && (
                  <ComposeNamedIcon
                    name={props.trailingIcon.name}
                    size={props.trailingIcon.size ?? iconSize.inline}
                    color={props.trailingIcon.color ?? colors.textMuted}
                  />
                )}
                {props.trailingBusy === true && (
                  <CircularProgressIndicator
                    color={colors.textMuted}
                    strokeWidth={2}
                    modifiers={[size(iconSize.inline, iconSize.inline)]}
                  />
                )}
                {props.selected === true && (
                  <ComposeNamedIcon name="checkmark" size={iconSize.inline} color={colors.text} />
                )}
              </Row>
            </ListItem.TrailingContent>
          )}
        </ListItem>
      </Host>
      {(position === "first" || position === "middle") && <View style={styles.separator} />}
    </View>
  );
}
