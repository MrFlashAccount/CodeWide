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
    if (props.disabled !== true) {
      props.onPress?.();
    }
  });
  const position = props.position ?? "only";
  const modifiers = [fillMaxWidth()];
  if (position === "only") {
    modifiers.push(clip(Shapes.RoundedCorner(radii.medium)));
  } else if (position === "first") {
    modifiers.push(clip(Shapes.RoundedCorner({ topEnd: radii.medium, topStart: radii.medium })));
  } else if (position === "last") {
    modifiers.push(
      clip(Shapes.RoundedCorner({ bottomEnd: radii.medium, bottomStart: radii.medium })),
    );
  }
  if (props.fixedHeight !== undefined) {
    modifiers.push(height(props.fixedHeight));
  }
  if (props.onPress !== undefined && props.disabled !== true) {
    modifiers.push(clickable(press));
  }
  return (
    <View
      accessibilityHint={props.accessibilityHint}
      accessibilityLabel={props.accessibilityLabel ?? props.title}
      accessibilityRole={
        props.onPress === undefined ? undefined : props.selected === undefined ? "button" : "radio"
      }
      accessibilityState={{
        busy: props.trailingBusy === true,
        disabled: props.disabled ?? false,
        ...(props.selected === undefined ? {} : { checked: props.selected }),
      }}
      accessible={props.onPress !== undefined && props.trailing === undefined}
      onAccessibilityTap={press}
      style={[
        styles.surface,
        styles[position],
        props.fixedHeight === undefined ? undefined : { height: props.fixedHeight },
        props.disabled === true && styles.disabled,
      ]}
      testID={props.testID}
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
          colors={{
            containerColor:
              props.selected === true ? colors.surfaceContainerHigh : colors.surfaceContainer,
            contentColor: props.danger === true ? colors.red : colors.text,
            supportingContentColor: colors.textMuted,
          }}
          modifiers={modifiers}
        >
          {props.leadingIcon !== undefined && (
            <ListItem.LeadingContent>
              <ComposeNamedIcon
                color={props.leadingIcon.color ?? colors.textMuted}
                name={props.leadingIcon.name}
                size={props.leadingIcon.size ?? iconSize.inline}
              />
            </ListItem.LeadingContent>
          )}
          <ListItem.HeadlineContent>
            <Text
              maxLines={props.multiline === true ? 2 : 1}
              overflow="ellipsis"
              style={{
                fontFamily: "RobotoFlex-Regular",
                fontSize: typeScale.body.fontSize,
                lineHeight: typeScale.body.lineHeight,
              }}
            >
              {props.title}
            </Text>
          </ListItem.HeadlineContent>
          {props.description !== undefined && props.description !== "" && (
            <ListItem.SupportingContent>
              <Row horizontalArrangement={{ spacedBy: spacing.xxs }} verticalAlignment="center">
                {props.descriptionIcon !== undefined && (
                  <ComposeNamedIcon
                    color={props.descriptionIcon.color ?? colors.textMuted}
                    name={props.descriptionIcon.name}
                    size={props.descriptionIcon.size ?? iconSize.inline}
                  />
                )}
                <Text
                  maxLines={props.multiline === true ? 2 : 1}
                  modifiers={[weight(1)]}
                  overflow="ellipsis"
                  style={{
                    fontFamily: "RobotoFlex-Regular",
                    fontSize: typeScale.label.fontSize,
                    lineHeight: typeScale.label.lineHeight,
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
              <Row horizontalArrangement={{ spacedBy: spacing.xs }} verticalAlignment="center">
                {props.trailingIcon !== undefined && (
                  <ComposeNamedIcon
                    color={props.trailingIcon.color ?? colors.textMuted}
                    name={props.trailingIcon.name}
                    size={props.trailingIcon.size ?? iconSize.inline}
                  />
                )}
                {props.trailingBusy === true && (
                  <CircularProgressIndicator
                    color={colors.textMuted}
                    modifiers={[size(iconSize.inline, iconSize.inline)]}
                    strokeWidth={2}
                  />
                )}
                {props.selected === true && (
                  <ComposeNamedIcon color={colors.text} name="checkmark" size={iconSize.inline} />
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
